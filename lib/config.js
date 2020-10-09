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

let options = {
    app : {
        appName : APP_NAME,
        appPort : DEFAULT_APP_PORT
    },
    log : {
        level : DEFAULT_LOG_LEVEL,
        maxLogSize : DEFAULT_MAX_LOG_SIZE
    }
}

module.exports.options = options;
module.exports.APP_NAME = APP_NAME;
module.exports.DEFAULT_LOG_DIR = DEFAULT_LOG_DIR;
module.exports.DEFAULT_APP_PORT = DEFAULT_APP_PORT;