/**********************************************************************************************/
/* file : main.js
/* author : Ashwinkumar R
/* 
/* This is the main entry point for the file to parse the command line arguments
/* and update required configuration options.
/* It starts the main server module.
/*
/***********************************************************************************************/

const config = require('./lib/config');
const dbService = require('./server');

function main() {
    let options = config.options;

    if(process.argv.length > 2) {
        console.log(`Received command line arguments`)
    }

    //parse the arguments
    for (var i=0; i < process.argv.length; i++) {
        var key = process.argv[i];
        var value = process.argv[i+1];
    
        if (key) {
            switch (key) {
                case '-level':
                    options.log.level = value;
                    break;
                case '-maxsize':
                    options.log.maxLogSize = value;
                    break;
                case '-port':
                    options.app.appPort = value;
                    break;
                case '-dbhost':
                    options.db_params.dbhost = value;
                    break;
                case '-dbport':
                    options.db_params.dbport = value;
                    break;
                case '-dbuser':
                    options.db_params.dbuser = value;
                    break;
                case '-dbpass':
                    options.db_params.dbpass = value;
                    break;
                case '-cafile':
                    options.db_params.cafile = value;
                    break;
            }
        }
    }

    //call main server module
    new dbService(options);
}

main();

process.on('unhandledRejection', (err, p) => {
    console.warn('main: unhandledRejection', err, p);
});
