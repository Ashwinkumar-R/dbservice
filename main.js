/**********************************************************************************************/
/* file : main.js
/* author : Ashwinkumar R
/* 
/* This is the main entry point for the file to parse the command line arguments
/* and update required configuration options.
/* It starts the main server module.
/*
/***********************************************************************************************/

function main() {
}

main();

process.on('unhandledRejection', (err, p) => {
    console.warn('main: unhandledRejection', err, p);
});
