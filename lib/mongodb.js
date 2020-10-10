const MongoClient = require('mongodb').MongoClient;
const  fs = require('fs');

const config = require('./config')
const common = require('./common')

const to = common.to; //wrapper to resolve "await" promise

class mongoDB {
    constructor(logger,options) {
        this.logger=logger;
        this.options=options;
        this.connected = false;
        this.dbclient = null;
        this.reconnectTimer = null;
        this.stopFlag = false;
        this.enums = config.enums;

        this.collectionList = ['user', 'visitor', 'conversation']; //List of colcetions to be created

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

            let connection_url = `mongodb://${that.dbParams.user}:${that.dbParams.password}@${that.dbParams.host}:${that.dbParams.port}/?ssl=true&ssl_ca_certs=${that.cafile}&replicaSet=rs0&readPreference=primary`;

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

    // Type of request on which we should operate, either db/collection
    getRequestType(params) {
        if (params.type == 'customer') {
            return this.enums.type.CUSTOMER;
        } else if (params.type == 'user') {
            return this.enums.type.USER;
        } else if (params.type == 'visitor') {
            return this.enums.type.VISITOR;
        } else if (params.type == 'conversation') {
            return this.enums.type.CONVERSATION;
        } else {
            return 0;
        }
    }

    //create DB and collection(new customer)
    async createDB(params) {
        let that = this;

        return new Promise(async (resolve, reject) => { 
            try {
                if (this.isConnected()) {

                    if (! params.name) {
                        reject (`createDB: Invalid/empty customer name`);
                    }
                    
                    //check DB already exists
                    let dbs = await that.dbclient.db().admin().listDatabases();
                    if (!dbs) { // TODO - check for actual DB
                        reject(`Database ${params.name} already exist`);
                    } else {
                        that.logger.debug(`createDB: creating DB ${params.name}`);

                        // specify db to be created
                        let db = await that.dbclient.db(params.name);
    
                        that.logger.debug(`createDB: creating collections ${that.collectionList}`);
    
                        // specify the collection to be created
                        that.collectionList.forEach(async function(collectionName) {
                            await db.createCollection(collectionName); //TODO - implement schema validator

                            //to avoid duplicates entries, have some unique key
                            let collection = db.collection(collectionName);
                            if (collectionName == 'conversation') {
                                await collection.createIndex({"name":1},{unique:true}); 
                            } else {
                                await collection.createIndex({"email":1},{unique:true});
                            }
                        })
    
                        resolve('success');    
                    }
                }
            } catch (err) {
                let msg = `Error creating DB/Collection, Error: ${err}`;
                that.logger.debug(`createDB: ${msg}`);
                reject(msg)
            }
        })
    }

    //Insert data into colection
    async insertToCollection(params, type) {
        let that = this;

        return new Promise(async (resolve, reject) => { 
            try {
                if (that.isConnected()) {
                    if (params.customer) { //DB name is needed
                        let db = that.dbclient.db(params.customer);

                        //TODO validate arguments - ignore if schema validator implemented
                        switch (type) {
                            case that.enums.type.USER :
                                break;
                            case that.enums.type.VISITOR :
                                break;
                            case that.enums.type.COVERSATION :
                                break;
                        }

                        let [err,res] = await to(db.collection(params.type).insertOne(params.data)); //insert to collection

                        if (err) {
                            let msg = `Error executing insert, Error ${err}`;
                            that.logger.debug(`insertToCollection: ${msg}`);
                            reject(msg);
                        } else {
                            that.logger.debug(`insertToCollection: Result:${JSON.stringify(res.result)}, Inserted ${JSON.stringify(res.ops)}`)
                            resolve('success');
                        }      
                    } else {
                        let msg = `param 'customer' missing`;
                        that.logger.debug(`insertToCollection: ${msg}`);
                        reject(msg);
                    }
                }
            } catch (err) {
                let msg = `Error inserting to Collection ${params.type}, Error: ${err}`;
                that.logger.debug(`createDB: ${msg}`);
                reject(msg)
            }
        })
    }

    //Insert data to the DB
    async insert(params) {
        let that = this;

        return new Promise(async (resolve, reject) => { 
            let type = that.getRequestType(params);

            if (!type) {
                reject(`Invalid DB/collection request type ${params.type}`);
            }
            
            try {
                if (type == that.enums.type.CUSTOMER) { //create DB
                    let result = await that.createDB(params);
                    resolve(result);
                } else {   //insert into collection
                    let result = await that.insertToCollection(params, type);
                    resolve(result);
                }
            } catch (err) {
                reject(err);
            }
        })
    }

    //Update data in the DB
    async update(params) {

    }

    //Delete data from the DB
    async delete(params) {

    }

    //Find data in the DB
    async find(params) {

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
