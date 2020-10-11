/*****************************************************************************************************/
/* file : config.js
/* author : Ashwinkumar R
/* 
/* This file is responsible for containing all the configuration required for the Application
/*
/*****************************************************************************************************/

const common = require('./common');

//APP options
const APP_NAME = 'dbservice';
const DEFAULT_APP_PORT = 8080;

//logging options
const DEFAULT_LOG_LEVEL = 'debug';
const DEFAULT_MAX_LOG_SIZE = null; // by default do not roll log
const DEFAULT_LOG_DIR = __dirname + '/../logs/';

//DB options
const DEFAULT_DB_HOST = 'localhost'; //cluster endpoint
const DEFAULT_DB_PORT = 27017;
const DEFAULT_DB_USER = 'admin';
const DEFAULT_DB_PASS = ''; // To be supplied as argument, DO NOT store default/initial password
const DEFAULT_DB_RECONNECT_TOUT = 30000; // reconnection attempt timeout interval
const DEFAULT_DB_CA_FILE = 'rds-combined-ca-bundle.pem'; //Amazon DocumentDB Certificate Authority (CA) certificate

let options = {
    app : {
        appName : APP_NAME,
        appPort : DEFAULT_APP_PORT
    },
    log : {
        level : DEFAULT_LOG_LEVEL,
        maxLogSize : DEFAULT_MAX_LOG_SIZE
    },
    db_params : {
        dbhost : DEFAULT_DB_HOST,
        dbport : DEFAULT_DB_PORT,
        dbuser : DEFAULT_DB_USER,
        dbpass : DEFAULT_DB_PASS,
        dbreconntout : DEFAULT_DB_RECONNECT_TOUT,
        cafile : DEFAULT_DB_CA_FILE
    }
}

let enums = {
    type : { // db/collection type
        CUSTOMER : 1, USER : 2, VISITOR : 3, CONVERSATION : 4
    },
    operation : {
        INSERT : 1, DELETE : 2, UPDATE : 3, FIND : 4
    }
}

module.exports.options = options;
module.exports.APP_NAME = APP_NAME;
module.exports.DEFAULT_LOG_DIR = DEFAULT_LOG_DIR;
module.exports.DEFAULT_APP_PORT = DEFAULT_APP_PORT;
module.exports.enums = enums;