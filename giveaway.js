const fs = require('fs');
const util = require('./nft_util.js');

let giveaways = JSON.parse(fs.readFileSync('giveaway.json'));

async function get_giveaway_info(id) {
  if (!giveaways[id]) {
    return false;
  }
  if (Date.now() > giveaways[id].end) {
    return false;
  }
  let nft_info = await util.is_valid_cidaccount(giveaways[id].nft);
  return [giveaways[id], nft_info];
}

module.exports = {
  get_giveaway_info: get_giveaway_info
}