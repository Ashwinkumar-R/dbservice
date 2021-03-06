/*****************************************************************************************************/
/* file : server.js
/* author : Ashwinkumar R
/*
/* This file is responsible for the following functionality
/*      - Creates and monitor DocumentDB connection
/*      - Creates Express server and required endpoints
/*      - Handles incoming request via API and send/receive all requests/responses to/from DB module
/*****************************************************************************************************/

const express = require('express');
const bodyParser = require('body-parser');
const ip = require('ip');

const common = require('./lib/common');
const config = require('./lib/config');
const logger = require('./lib/logger');
const dbConnection = require('./lib/mongodb');

const to = common.to; //wrapper to resolve "await" promise

// logging options
const LOG_FILE = config.DEFAULT_LOG_DIR + config.APP_NAME + '_' + common.getIsoTime() + '.log';

class dbService {
    constructor(options) {
        this.options = options;
        this.dbHandler = null; // db connection handler
        this.dbReconnectTimer = null; //db reconnection timer, used for reconnecting to DB
        this.appReady = false; // check application is initialized, (db connection should be ready)

        this.enums = config.enums; //enum values

        //init logger
        let logParams = {
            level : this.options.log.level,
            maxLogSize : this.options.log.maxLogSize,
            name : config.APP_NAME,
            logFile : LOG_FILE,
        }

        this.logger=new logger(logParams);

        process.on( 'SIGTERM', () => {
            this.logger.debug('SIGTERM: Gracefully stop dbService Application');
            this.closeConnections();
        });
        
        process.on( 'SIGINT', () => {
            this.logger.debug('SIGINT: Gracefully stop dbService Application');
            this.closeConnections();
        });

        this.init_app();
    }

    /****************************** 
       Main app related methods
    *******************************/

    // module to start the app
    async init_app() {
        this.logger.info('init_app: Start initializing the main modules')

        //intialize db connection
        await this.init_db();

        //initialize APIs
        await this.init_routes();
    }

    //To check whether App is ready to process request to/from DB
    isAppReady() {
        return this.appReady && this.dbHandler.isConnected();
    }

    /**********************************
      DB related methods and operation 
    ***********************************/

    async init_db() {
        if (!this.dbHandler) {
            this.dbHandler = new dbConnection(this.logger, this.options);
        }

        //clear previous db reconnect timers
        if (this.dbReconnectTimer !== null) {
            clearTimeout(this.dbReconnectTimer);
            this.dbReconnectTimer = null;
        }

        try {
            await this.dbHandler.connect();
            this.logger.debug(`init_db: Successfully connected to DocumentDB`);
            this.appReady = true; //set the application to ready state
        } catch (err) {
            this.appReady = false;
            this.logger.error(err);
            this.logger.debug(`init_db: Init the DocumentDB reconnecting with ${this.options.db_params.dbreconntout} ms delay...`);
            this.dbReconnectTimer = setTimeout(this.init_db.bind(this), this.options.db_params.dbreconntout); // In case of connection error, retry connecting after given secs
        }
    }

    // send request to perform db related operations
    async performDBOperation(params,operation) {
        if (this.isAppReady()) {
            switch (operation) {
                case this.enums.operation.INSERT :
                    var [err,res] = await to(this.dbHandler.insert(params));
                    break;
                case this.enums.operation.DELETE :
                    var [err,res] = await to(this.dbHandler.delete(params));
                    break;
                case this.enums.operation.UPDATE :
                    var [err,res] = await to(this.dbHandler.update(params));
                    break;
                case this.enums.operation.FIND :
                    var [err,res] = await to(this.dbHandler.find(params));
                    break;    
            }

            if (err) {
                let msg = `Error performing DB operation, Error: ${err}`;
                this.logger.debug(`performDBOperation: ${msg}`)
                return {status: 'error', msg: msg};
            } else {
                return {status: 'ok', result: res};
            }
        } else {
            const msg = 'DB connection is not ready..';
            this.logger.debug(`performDBOperation: ${msg}`);
            return {status:'error', error:msg};
        }
    }

    /**********************************
        Init Express server and API
    ***********************************/

    // Init the express server and configure all the routes
    async init_routes() {
        let that = this;
        let app = express();
        app.use(bodyParser.json());

        // Define a base route point
        let router = express.Router();
        app.use('/dbservice',router);

        // Express middleware wrapper to deal with async callbacks, will raise errors to next middleware handler
        const  asyncExpHandler = fn => (req, res, next) =>
        Promise
            .resolve(fn(req, res, next))
            .catch(next);

        //
        router.post('/insertData', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
            if (args) {
                let output = await that.performDBOperation(args, that.enums.operation.INSERT);

                if (output.status == 'ok') {
                    let msg = `successfully executed`;
                    res.status(200).send({result:'ok', msg:msg});    
                } else {
                    res.status(404).send({result:'error', msg:output.msg});
                }
            } else {
                let msg = `empty arguments`;
                res.status(400).send({result:'error', msg:msg});
            }
        }))

        router.delete('/deleteData', asyncExpHandler(async function (req,res,next) {
            if (!req.query && !req.query.type && !req.query.key) {
                let msg = `required arguments are missing`;
                res.status(400).send({result:'error', msg:msg});         
            } else {
                if(req.query.type != 'customer' && !req.query.customer) {
                    let msg = `argument 'customer' is missing`;
                    res.status(400).send({result:'error', msg:msg});           
                }

                let output = await that.performDBOperation(req.query, that.enums.operation.DELETE);

                if (output.status == 'ok') {
                    let msg = `successfully executed`;
                    res.status(200).send({result:'ok', msg:msg});    
                } else {
                    res.status(404).send({result:'error', msg:output.msg});
                }
            }
        }))

        router.put('/updateData', asyncExpHandler(async function (req,res,next) {
            if (!req.query && !req.query.type && !req.query.customer && !req.query.key && !req.query.newdata) {
                let msg = `required arguments are missing`;
                res.status(400).send({result:'error', msg:msg});         
            } else {
                let output = await that.performDBOperation(req.query, that.enums.operation.UPDATE);

                if (output.status == 'ok') {
                    let msg = `successfully executed`;
                    res.status(200).send({result:'ok', msg:msg});    
                } else {
                    res.status(404).send({result:'error', msg:output.msg});
                }
            }
        }))

        router.get('/findData', asyncExpHandler(async function (req,res,next) {
            // if document arg is not present, default assume as all matching records are requested
            if (!req.query && !req.query.type && !req.query.customer && !req.query.query) {
                let msg = `required arguments are missing`;
                res.status(400).send({result:'error', msg:msg});         
            } else {
                let output = await that.performDBOperation(req.query, that.enums.operation.FIND);

                if (output.status == 'ok') {
                    let msg = `successfully executed`;
                    res.status(200).send({result:'ok', data:output.result});    
                } else {
                    res.status(404).send({result:'error', msg:output.msg});
                }
            }
        }))

        //middleware to handle errors
        router.use(function(err, req, res, next) {
            that.logger.error('Unhandled error occurred: ' + err);
            res.send('Server error occurred');
        });

        let appPort = this.options.app.appPort || config.DEFAULT_APP_PORT; //port on which app listens
        app.set('port',appPort);

        app.listen(appPort, function() {
            that.logger.info(`init_routes: Application dbService running on http://${ip.address()}:${appPort}`)
        }).on('error', function(err) {
            that.logger.error(`init_routes: Error starting server. Err: ${err.message} Terminating process`);
            that.closeConnections();
        });
    }

    /***********************************
      Final closeup actions during exit
    ************************************/

    // To gracefully close connections and final cleanup
    async closeConnections() {
        this.plannedStop = true;
        if (this.dbHandler) {
            await this.dbHandler.close(); //close db connection
        }

        this.logger.debug('closeConnections: Exiting');
        await common.sleep(1000); //2secs grace period to complete writing final logs
        process.exit();

    }
}

module.exports = dbService;