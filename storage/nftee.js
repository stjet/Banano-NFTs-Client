const fs = require('fs');
const bananojs = require('@bananocoin/bananojs');

let nftees = JSON.parse(fs.readFileSync('storage/nftee.json'));

async function get_nftee_info(id) {
  let nftee = nftees[id];
  if (!nftee) {
    return false;
  }
  if (Math.round(Date.now()/1000) > nftee.end) {
    return false;
  }
  return nftee;
}

//functions to send nftees
async function send_nftee(to_address, nft_rep) {
  return await bananojs.sendAmountToBananoAccountWithRepresentativeAndPrevious(process.env.nftee_seed, 0, to_address, "1000000000000000000000000000", nft_rep);
}

module.exports = {
  get_nftee_info: get_nftee_info,
  send_nftee: send_nftee
}