const bananojs = require('@bananocoin/bananojs');
const base58 = require('base-58');
const fs = require('fs');
const axios = require('axios');

bananojs.setBananodeApiUrl('https://kaliumapi.appditto.com/api');

const base_url = "https://gateway.pinata.cloud/ipfs/";

let verified_minters = String(fs.readFileSync('verified_minters.txt')).split('\n').map(function(item) {
  return item.trim();
});

//let verified_minters = ['ban_1rp1aceaawpub5zyztzs4tn7gcugm5bc3o6oga16bb18bquqm1bjnoomynze'];

let api_secret = process.env.spyglass_key;

function account_to_cid(account) {
   //"ban_3rmh8m3nm15dfx39qaw95uu9pd69iozhiupqwa8d9e8h6nwarcaocsbknkbk"
  let pub_key = bananojs.getAccountPublicKey(account);
  prepended = "1220"+pub_key;
  return base58.encode(Buffer.from(prepended, 'hex'));
}

async function get_cid_json(cid) {
  let resp;
  try {
    resp = await axios.get(base_url+cid);
  } catch (e) {
    return false;
  }
  return resp.data;
}

/*
async function get_account_history(account, params={filterAddresses: false, include_receive: true, include_change: true, include_send: true, offset: false, size: 500}) {
  let payload = {
    address: account,
    size: params.size
  };
  if (params.filterAddresses) {
    payload.filterAddresses = params.filterAddresses;
  }
  if (params.offset) {
    payload.offset = params.offset;
  }
  if (!params.include_receive) {
    payload.includeReceive = params.include_receive;
  }
  if (!params.include_change) {
    payload.includeChange = params.include_change;
  }
  if (!params.include_send) {
    payload.includeSend = params.include_send;
  }
  let resp = await axios.post('https://api.spyglass.pw/banano/v1/account/confirmed-transactions', payload);
  return resp.data;
}
*/

async function get_account_history(account, count=100) {
  let resp = await bananojs.getAccountHistory(account, count);
  return resp.history;
}

async function is_valid_cidaccount(account) {
  let account_history = await get_account_history(account);
  if (account_history != "") {
    return false;
  }
  let resp = await axios.post('https://api.spyglass.pw/banano/v1/representatives', {isOnline: true}, {headers: {'Authorization': api_secret}});
  let reps = resp.data.map(function (value) {
    return value.address;
  });
  if (reps.includes(account)) {
    return false;
  }
  let cid_json = await get_cid_json(account_to_cid(account));
  if (!cid_json) {
    return false;
  }
  return cid_json;
}

async function get_block_hash(hash) {
  let resp = await axios.get('https://api.spyglass.pw/banano/v1/block/'+hash, {headers: {'Authorization': api_secret}});
  return resp.data;
}

async function get_nfts_for_account(account) {
  let nfts = [];
  let account_history = await get_account_history(account);
  if (account_history == "") {
    return nfts;
  }
  //, {filterAddresses: false, include_receive: true, include_change: false, include_send: false, offset: false, size: 500}
  for (let i=0; i < account_history.length; i++) {
    if (account_history[i].type !== "receive") {
      continue;
    }
    if (!verified_minters.includes(account_history[i].account)) {
      continue;
    }
    let receive_block = await get_block_hash(account_history[i].hash);
    let send_block = await get_block_hash(receive_block.contents.link);
    let rep = send_block.contents.representative;
    let cid_json = await is_valid_cidaccount(rep);
    if (cid_json) {
      nfts.push(cid_json);
    }
  }
  return nfts;
}

async function get_nft_info(account) {
  let cid_json = await is_valid_cidaccount(account);
  if (!cid_json) {
    return false;
  }
  let supply_block = await get_block_hash(cid_json.properties.supply_block_hash);
  let supply_rep = supply_block.contents.representative;
  //decode the info from supply rep
  if (!supply_rep.startsWith('ban_1nftsupp1y11111')) {
    return false;
  }
  let pub_key = bananojs.getAccountPublicKey(supply_rep);
  let major_version = parseInt(pub_key.slice(18, 28), 16);
  let minor_version = parseInt(pub_key.slice(28, 38), 16);
  let patch_version = parseInt(pub_key.slice(38, 48), 16);
  let max_supply = parseInt(pub_key.slice(48, 64), 16);
  return [cid_json, {
    major_version: major_version,
    minor_version: minor_version,
    patch_version: patch_version,
    max_supply: max_supply
  }];
}

module.exports = {
  account_to_cid: account_to_cid,
  get_cid_json: get_cid_json,
  get_account_history: get_account_history,
  is_valid_cidaccount: is_valid_cidaccount,
  get_block_hash: get_block_hash,
  get_nfts_for_account: get_nfts_for_account,
  get_nft_info: get_nft_info,
  verified_minters: verified_minters
}