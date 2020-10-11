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

        //secondary replica connection handler
        this.secondaryHandler = {
            replica1 : null,
            replica2 : null,
            replica3 : null
        }
    }

    /***********************************
        DB connection handlers
    ************************************/

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

    // open a connection handle for secondary replica for find operations
    async updateSecondaryHandler() {
        let that = this;
        return new Promise(async (resolve,reject) => {

            let replicas = that.cluster;

            try {
                for (const replica in replicas) {
                    if (replica === 'primary') { //ignore primary instance
                        continue;
                    } else if (replicas[replica]) { //secondary instances
                        that.logger.debug(`updateSecondaryHandler: Connecting to DocumentDB at secondary replica ${replicas[replica]}`);
    
                        let connection_url = `mongodb://${that.dbParams.user}:${that.dbParams.password}@${replicas[replica]}/?ssl=true&ssl_ca_certs=${that.cafile}&retryWrites=false`;
                        
                        try {
                            that.secondaryHandler[replica] = await MongoClient.connect(connection_url, 
                            { sslValidate: true, sslCA:that.dbParams.ca, useNewUrlParser: true, useUnifiedTopology: true });
                            
                            that.logger.info(`updateSecondaryHandler: Connected to DocumentDB at secondary replica ${replicas[replica]}`);
                        } catch (err) {
                            that.logger.error(`updateSecondaryHandler: The connection to DocumentDB at secondary replica ${replicas[replica]} failed. Error: ${err}`)
                            that.secondaryHandler[replica] = null;
                        }
                    } else {
                        that.logger.error(`updateSecondaryHandler: replica details empty for ${replica}`);
                    }
                }
                resolve(that.secondaryHandler);
            } catch (err) {
                that.logger.error(`updateSecondaryHandler: Error on getting secondaray connections. Error ${err}`);
                reject(err);
            }
        })
    }

    // Handler for find operation based on the collection type
    async getFindHandler(params) {
        return new Promise(async (resolve, reject) => { 
            if (params.type == 'user') {
                this.secondaryHandler.replica1 ? resolve(this.secondaryHandler.replica1) : reject(`empty db handler, coult not query`);
            } else if (params.type == 'visitor') {
                this.secondaryHandler.replica2 ? resolve(this.secondaryHandler.replica2) : reject(`empty db handler, coult not query`);
            } else if (params.type == 'conversation') {
                this.dbclient ? resolve(this.dbclient) : reject(`empty db handler, coult not query`);
            } else {
                reject(`unsupported operation type`);
            }
        })
    }

    // collect and update the details about the replicas
    async collectReplicas() {
        let that = this;
        
        return new Promise(async (resolve, reject) => { 
            try {
                const replicaSet = await that.dbclient.db('admin').admin().replSetGetStatus(); //all instances in cluster
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

                try {
                    await that.updateSecondaryHandler(); //create a connection handlers for secondary connection
                } catch (err) {
                    that.logger.debug(`collectReplicas: ${err}`);
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

            that.dbclient.close();
            resolve();
        })
    }

    /***********************************
        DB operation helpers
    ************************************/

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

    /***********************************
          insert methods
    ************************************/

    //create DB and collection(new customer)
    async createDB(params) {
        let that = this;

        return new Promise(async (resolve, reject) => { 
            try {
                if (that.isConnected()) {

                    if (! params.name) {
                        reject (`createDB: Invalid/empty customer name`);
                    }
                    
                    //check DB already exists
                    let isDBExist = false;
                    let dbs = await that.dbclient.db().admin().listDatabases();

                    if (dbs && dbs.databases) {
                        for (var db in dbs.databases) {
                            if (dbs.databases[db].name == params.name) {
                                isDBExist = true;
                                break;
                            }
                        }
                    }

                    if (isDBExist) { //DB exist
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
                            if (collectionName == 'conversation') { //unique key 'name'
                                await collection.createIndex({"name":1},{unique:true}); 
                            } else { //unique key 'email'
                                await collection.createIndex({"email":1},{unique:true});
                            }
                        })
    
                        resolve('success');    
                    }
                } else {
                    reject (`DB connection is not ready`);
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
                            if (res.result.n != 0 && res.result.ok == 1) {
                                that.logger.debug(`insertToCollection: Result:${JSON.stringify(res.result)}, Inserted ${JSON.stringify(res.ops)}`)
                                resolve(res);
                            } else {
                                reject (`record ${params.data} from DB:${params.customer}, collection:${params.type} not inserted`);
                            }
                        }      
                    } else {
                        let msg = `param 'customer' missing`;
                        that.logger.debug(`insertToCollection: ${msg}`);
                        reject(msg);
                    }
                } else {
                    reject (`DB connection is not ready`);
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
                that.logger.debug(`insert: Error while inserting, Error: ${err}`);
                reject(err);
            }
        })
    }

    /***********************************
            delete methods
    ************************************/

    //Delete data from the DB or delete DB itself
    async delete(params) {
        let that = this;

        return new Promise(async (resolve, reject) => { 
            let type = that.getRequestType(params);

            if (!type) {
                reject(`Invalid DB/collection request type ${params.type}`);
            }
            
            try {
                if (that.isConnected()) {
                    let db = that.dbclient.db(params.customer);

                    if (type == that.enums.type.CUSTOMER) { //delete DB
                        let [err,result] = await to(db.dropDatabase());

                        if (err) {
                            let msg = `Error deleting DB ${params.customer}, Error: ${err}`;
                            that.logger.debug(`delete: ${msg}`);
                            reject(msg);
                        } else {
                            resolve(result);
                        }
                    } else {   //delete record from collection
                        let query = (type == that.enums.type.CONVERSATION) ? {"name":params.key} : {"email":params.key}; //record to be deleted 
                        
                        let [err,res] = await to(db.collection(params.type).deleteOne(query)); //delete

                        if (err) {
                            let msg = `Error deleting record ${params.key} from DB:${params.customer}, collection:${params.type}, Error: ${err}`;
                            that.logger.debug(`delete: ${msg}`);
                            reject(msg);
                        } else {
                            if (res.result.n != 0 && res.result.ok == 1) { //check result and modification count
                                resolve(res);
                            } else {
                                reject (`record ${params.key} from DB:${params.customer}, collection:${params.type} not found for deleting`);
                            }
                        }                    
                    }
                } else {
                    reject (`DB connection is not ready`);
                }
            } catch (err) {
                that.logger.debug(`delete: Error while deleting, Error: ${err}`);
                reject(err);
            }
        })
    }

    /***********************************
            updated methods
    ************************************/

    //Update data in the DB
    async update(params) {
        let that = this;

        return new Promise(async (resolve, reject) => { 
            let type = that.getRequestType(params);

            if (!type) {
                reject(`Invalid DB/collection request type ${params.type}`);
            }
            
            try {
                if (that.isConnected()) {
                    let db = that.dbclient.db(params.customer);

                    if (type == that.enums.type.CUSTOMER) { //no modification on DB details
                        reject(`Updates are allowed on collection and not on DB`);
                    } else {   //update record in collection
                        let query = (type == that.enums.type.CONVERSATION) ? {"name":params.key} : {"email":params.key}; //record to be deleted 
                        var newvalues = { $set: JSON.parse(params.newdata) };

                        let [err,res] = await to(db.collection(params.type).updateOne(query, newvalues)); //update

                        if (err) {
                            let msg = `Error updating record ${params.key} from DB:${params.customer}, collection:${params.type}, Error: ${err}`;
                            that.logger.debug(`update: ${msg}`);
                            reject(msg);
                        } else {
                            if (res.result.n != 0 && res.result.ok == 1) { //check result and modification count
                                resolve(res);
                            } else {
                                reject (`record ${params.key} from DB:${params.customer}, collection:${params.type} not found for updating`);
                            }
                        }                    
                    }
                } else {
                    reject (`DB connection is not ready`);
                }
            } catch (err) {
                that.logger.debug(`delete: Error while deleting, Error: ${err}`);
                reject(err);
            }
        })
    }

    /***********************************
            find methods
    ************************************/

    //Find data in the DB
    async find(params) {
        let that = this;

        return new Promise(async (resolve, reject) => { 
            let type = that.getRequestType(params);

            if (!type) {
                reject(`Invalid DB/collection request type ${params.type}`);
            }
            
            try {
                if (that.isConnected()) {
                    if (type == that.enums.type.CUSTOMER) { //no find on DB details
                        reject(`find allowed only on collection and not on DB`);
                    } else {   //find record/records in collection
                        let query = params.query; //query to be find

                        let document = params.document && params.document == 'single' ? 'fineOne' : 'find';


                        let dbhandler = await that.getFindHandler(params); // find replica to connect

                        let db = dbhandler.db(params.customer); //open DB

                        if (document == 'fineOne') { //findOne
                            var [err,res] = await to(db.collection(params.type).findOne(JSON.parse(query))); 
                        } else { //find all
                            var [err,res] = await to(db.collection(params.type).find(JSON.parse(query)).toArray());
                        }

                        if (err) {
                            let msg = `Error getting record ${query} from DB:${params.customer}, collection:${params.type}, Error: ${err}`;
                            that.logger.debug(`find: ${msg}`);
                            reject(msg);
                        } else {
                            if (res && res.length != 0) { //check result
                                resolve(res);
                            } else {
                                reject (`record ${query} from DB:${params.customer}, collection:${params.type} not found`);
                            }
                        }                    
                    }
                } else {
                    reject (`DB connection is not ready`);
                }
            } catch (err) {
                that.logger.debug(`find: Error while getting record, Error: ${err}`);
                reject(err);
            }
        })
    }
}

module.exports = mongoDB;
