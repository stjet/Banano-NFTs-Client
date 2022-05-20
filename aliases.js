const fs = require('fs');

function get_alias(alias) {
  let aliases = JSON.parse(fs.readFileSync('aliases.json'));
  let address = aliases[alias];
  if (!address) {
    return false;
  }
  return address;
}

module.exports = {
  get_alias: get_alias
}