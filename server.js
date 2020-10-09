/*****************************************************************************************************/
/* file : server.js
/* author : Ashwinkumar R
/*
/*****************************************************************************************************/

const express = require('express');
const bodyParser = require('body-parser');
const ip = require('ip');

const common = require('./lib/common');
const config = require('./lib/config');
const logger = require('./lib/logger');

const to = common.to; //wrapper to resolve "await" promise

// logging options
const LOG_FILE = config.DEFAULT_LOG_DIR + config.APP_NAME + '_' + common.getIsoTime() + '.log';

class dbService {
    constructor(options) {
        this.options = options;

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

        //initialize APIs
        await this.init_routes();
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

        /* customers/DB endpoints */

        router.post('/addCustomer', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.post('/deleteCustomer', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.get('/getCustomer', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.get('/getAllCustomers', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        /* user/visitors endpoints */

        router.post('/addUser', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.post('/addVisitor', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.post('/deleteUser', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.post('/deleteVisitor', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.post('/updateUser', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.post('/updateVisitor', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.get('/getUser', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.get('/getAllUsers', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.get('/getVisitor', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.get('/getAllVisitors', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        /* conversation endpoints */  

        router.post('/addConversation', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.post('/deleteConversation', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.post('/updateConversation', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.get('/getConversation', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
        }))

        router.get('/getAllConversation', asyncExpHandler(async function (req,res,next) {
            let args = req.body;
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
        process.exit();
    }
}

module.exports = dbService;