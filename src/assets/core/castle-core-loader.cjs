window = {}
window.screen = {}
window.screen.width = 800;
window.screen.height = 600;
screen = window.screen;
window.addEventListener = function() {};
document = {}
document.addEventListener = function() {};
document.querySelector = function() {};
addEventListener = function() {};
window.document = document;
document.body = {};
document.body.addEventListener = function() {};

Module = {
  locateFile: (path, scriptDirectory) => {
    console.log(`Locating file: ${path}`);
    console.log(`Script directory: ${scriptDirectory}`);
    return scriptDirectory + path;
  },
};

require('./castle-core.cjs');
