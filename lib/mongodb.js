const MongoClient = require('mongodb').MongoClient;
const  fs = require('fs');

class mongoDB {
    constructor(logger,options) {
        this.logger=logger;
        this.options=options;

        //check and read the certificate
        this.cafile = this.options.db_params.cafile ? this.options.db_params.cafile : process.env.CAFILE;
        const ca = this.cafile ? [fs.readFileSync(this.cafile)] : null;
        
        //db details
        this.dbParams = {
            user: this.options.db_params.dbuser,
            password: this.options.db_params.dbpass, 
            host: this.options.db_params.dbhost, 
            port: this.options.db_params.dbport,
            reconnect_timeout:  this.options.db_params.dbreconntout,
            ca : ca
        }

        //DocumentDB cluster 
        this.cluster = {
            primary : null,
            replica1 : null,
            replica2 : null,
            replica3 : null
        }
    }

    //Make connection to DocumentDB using the cluster endpoint
    async connect_client() {
        let that = this;
        return new Promise(async (resolve,reject) => {

            that.logger.debug(`connect_client: Connecting to DocumentDB at cluster endpoint ${that.dbParams.host}`);

            let connection_url = `mongodb://${that.dbParams.user}:${that.dbParams.password}@${that.dbParams.host}:${that.dbParams.port}/?ssl=true&ssl_ca_certs=${that.cafile}&replicaSet=rs0&readPreference=secondaryPreferred`;

            try {
                that.dbclient = await MongoClient.connect(connection_url, 
                { sslValidate: true, sslCA:that.dbParams.ca, useNewUrlParser: true, useUnifiedTopology: true });
                
                that.connected = true;
                that.logger.info(`connect_client: Connected to DocumentDB at cluster endpoint ${that.dbParams.host}`);
                resolve(that.dbclient);
            } catch (err) {
                let msg = `The connection to MongoDB has failed. Error: ${err}`
                that.dbclient = null;
                that.connected = false;
                reject(msg);
            }
        })
    }

    //Try reconnect to DocumentDB if the active connection is closed
    async reconnect() {
        let that = this;
        return new Promise(async (resolve, reject) => {

            if(that.reconnectTimer !== null) {
                clearTimeout(that.reconnectTimer)
                that.reconnectTimer = null;
            }

            try {
                that.dbConn = await that.connect_client();
        
                that.dbConn.on('close', function() {
                    that.dbclient = null;
                    that.connected = false;
                    that.logger.info(`connect: Connection to DocumentDB closed`);
                    //Try reconnecting after given secs, since connection is closed unexpectedly
                    if (!that.stopFlag) {
                        that.logger.debug(`connect: Try reconnecting after ${that.options.this.dbParams.reconnect_timeout} ms delay`);
                        that.reconnectTimer = setTimeout(that.reconnect.bind(that), that.options.this.dbParams.reconnect_timeout);    
                    }
                });

                await that.collectReplicas(); // collect details about the replicas

                resolve(that.dbConn); //send the connection handler
            } catch (err) {
                that.dbclient = null;
                that.connected = false;
                that.logger.debug(`reconnect: DocumentDB reconnect attempt failed, continue retrying after ${that.options.dbParams.reconnect_timeout} ms delay`);
                that.reconnectTimer = setTimeout(that.reconnect.bind(that), that.options.dbParams.reconnect_timeout);
            }
        })
    }

    //Initiate connection to DocumentDB
    async connect() {
        let that = this;
        return new Promise(async (resolve, reject) => {

            if(that.reconnectTimer !== null) {
                clearTimeout(that.reconnectTimer)
                that.reconnectTimer = null;
            }
            try {
                that.dbConn = await that.connect_client();
        
                that.dbConn.on('close', function() {
                    that.dbclient = null;
                    that.connected = false;
                    that.logger.info(`connect: Connection to DocumentDB closed`);
                    //Try reconnecting after given secs, since connection is closed unexpectedly
                    if (!that.stopFlag) {
                        that.logger.debug(`connect: Try reconnecting after ${that.options.this.dbParams.reconnect_timeout} ms delay`);
                        that.reconnectTimer = setTimeout(that.reconnect.bind(that), that.options.this.dbParams.reconnect_timeout);    
                    }
                });

                await that.collectReplicas(); // collect details about the replicas

                resolve(that.dbConn); //send the connection handler
            } catch (err) {
                that.dbclient = null;
                that.connected = false;
                reject(err);
            }
        })
    }

    // collect and update the details about the replicas
    async collectReplicas() {
        let that = this;
        
        return new Promise(async (resolve, reject) => { 
            try {
                const replicaSet = await that.dbclient.db('admin').admin().replSetGetStatus();
                const replicaMembers = replicaSet.members;
                let secondaryCount = 0;
        
                for (const replica in replicaMembers) {
                    let member = replicaMembers[replica];
                    if (member.health === 1 && member.state === 1) { //primary instance
                        that.cluster.primary = member.name;
                    } else if (member.health === 1 && member.state === 2) { //secondary instances
                        secondaryCount++;
                        that.cluster['replica'+secondaryCount] = member.name;
                    }
                }
                resolve();    
            } catch (err) {
                let msg = `collectReplicas: Error collecting replicas details, Error: ${err}`;
                that.logger.debug(msg);
                reject(err);
            }
        })
    }

    // To validate if connection is opened
    isConnected() {
        return (this.dbclient && this.connected);
    }

    //Close connection to DocumentDB
    async close() {
        let that = this;
        return new Promise((resolve, reject) => {
            if (that.dbclient === null) {
                resolve();
            }

            if (that.reconnectTimer) {
                clearTimeout(that.reconnectTimer);
                that.reconnectTimer = null;
            }
          
            that.stopFlag = true;

            that.logger.debug(`close: Closing DocumentDB server connection`);

            that.dbclient.close()
        })
    }
}

module.exports = mongoDB;