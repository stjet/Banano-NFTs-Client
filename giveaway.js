const fs = require('fs');
//const util = require('./nft_util.js');

let giveaways = JSON.parse(fs.readFileSync('giveaway.json'));

async function get_giveaway_info(id) {
  let giveaway = giveaways[id];
  if (!giveaway) {
    return false;
  }
  if (Math.round(Date.now()/1000) > giveaway.end) {
    return false;
  }
  return giveaways[id];
}

module.exports = {
  get_giveaway_info: get_giveaway_info
}