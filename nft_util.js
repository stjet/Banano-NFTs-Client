const bananojs = require('@bananocoin/bananojs');
const base58 = require('base-58');
const fs = require('fs');
const axios = require('axios');
const CID = require('cids');

bananojs.setBananodeApiUrl('https://kaliumapi.appditto.com/api');

const base_url = "https://gateway.pinata.cloud/ipfs/";

let nft_cache = {};
//let owners_cache = {};
//cache should store nfts and block height at snapshot. If block height is unchanged, keep using cache
//let account_history_cache = {};

let verified_minters = String(fs.readFileSync('verified_minters.txt')).split('\n').map(function(item) {
  return item.trim();
});

let api_secret = process.env.spyglass_key;

function v0_to_v1(v0_cid) {
  return new CID(v0_cid).toV1().toString('base32');
}

function account_to_cid(account) {
   //"ban_3rmh8m3nm15dfx39qaw95uu9pd69iozhiupqwa8d9e8h6nwarcaocsbknkbk"
  let pub_key = bananojs.getAccountPublicKey(account);
  prepended = "1220"+pub_key;
  return base58.encode(Buffer.from(prepended, 'hex'));
}

async function get_cid_json(cid) {
  let resp;
  try {
    resp = await axios.get(base_url+cid, {
      timeout: 5000
    });
  } catch (e) {
    try {
      resp = await axios.get("https://ipfs.eth.aragon.network/ipfs/"+v0_to_v1(cid), {
        timeout: 2000
      });
    } catch {
      return false;
    }
  }
  return resp.data;
}

/*
async function get_account_history(account, count=450) {
  //limit is 3000 ish for this
  let resp = await bananojs.getAccountHistory(account, count);
  return resp.history;
}
*/

async function get_account_history(account, receive_only=false, send_only=false, count=50) {
  let payload = {
    address: account,
    size: String(count)
  };
  if (receive_only && send_only) {
    payload.includeChange = false;
  } else if (receive_only) {
    payload.includeChange = false;
    payload.includeSend = false;
  } else if (send_only) {
    payload.includeChange = false;
    payload.includeReceive = false;
  }
  let resp = await axios.post('https://api.spyglass.pw/banano/v1/account/confirmed-transactions', payload, {headers: {'Authorization': api_secret}});
  return resp.data;
}

async function is_valid_cidaccount(account) {
  //check for unopened
  //it must be unopened
  try {
    await get_account_history(account);
    return false;
  } catch (e) {
  }
  let resp = await axios.get('https://api.spyglass.pw/banano/v1/representatives/online', {headers: {'Authorization': api_secret}});
  let reps = resp.data;
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
  let resp;
  try {
    resp = await axios.get('https://api.spyglass.pw/banano/v1/block/'+hash, {headers: {'Authorization': api_secret}});
  } catch (e) {
    return false;
  }
  return resp.data;
}

//hashes: array of hash
async function get_block_hashes(hashes) {
  //limit 500
  try {
    let resp = await axios.post('https://api.spyglass.pw/banano/v1/blocks', {blocks: hashes}, {headers: {'Authorization': api_secret}});
    return resp.data;
  } catch (e) {
    return false;
  }
}

async function get_nfts_for_account(account) {
  let validation_info = bananojs.getBananoAccountValidationInfo(account);
  if (!validation_info.valid) {
    return false;
  }
  let nfts = [];
  let account_history;
  try {
    account_history = await get_account_history(account, receive_only=true, send_only=true);
  } catch (e) {
    return nfts;
  }
  //, {filterAddresses: false, include_receive: true, include_change: false, include_send: false, offset: false, size: 500}
  let hashes = account_history.map(function(item) {
    return item.hash;
  });
  //set order from youngest to oldest
  hashes = hashes.reverse();
  account_history = await get_block_hashes(hashes);
  //track receives of nfts, then make sure they arent sent
  //condense multiple api calls into one (send block optimizations)
  let send_block_hashes = account_history.filter(function(item) {
    return item.subtype === "receive";
  }).map(function (item) {
    //return the send hash
    return item.contents.link;
  });
  let corresponding_send_blocks = await get_block_hashes(send_block_hashes);
  //mint block optimizations
  /*
  let mint_block_hashes = account_history.filter(function(item) {
    return item.subtype === "receive" && !verified_minters.includes(item.sourceAccount);
  }).map(function (item) {
    return bananojs.getAccountPublicKey(item.contents.representative);
  });
  let corresponding_mint_blocks = await get_block_hashes(send_block_hashes);
  */
  //start actual tracking
  let tracking = {};
  for (let i=0; i < account_history.length; i++) {
    if (account_history[i].subtype == "receive") {
      //let send_block = await get_block_hash(account_history[i].contents.link);
      let send_block_hash_index = send_block_hashes.indexOf(account_history[i].contents.link);
      let send_block = corresponding_send_blocks[send_block_hash_index];
      let rep;
      //checks if nft comes directly from a verified minter
      if (!verified_minters.includes(account_history[i].sourceAccount)) {
        let pub_key_hash = bananojs.getAccountPublicKey(send_block.contents.representative);
        //most of the requests are from here
        let mint_block = await get_block_hash(pub_key_hash);
        if (!mint_block) {
          continue;
        }
        rep = mint_block.contents.representative;
      } else {
        rep = send_block.contents.representative;
      }
      let cid_json = await is_valid_cidaccount(rep);
      if (cid_json) {
        if (!verified_minters.includes(account_history[i].sourceAccount)) {
          //we may have to trace ownership here. prefer not to do this. instead we have certainty and uncertainty
          cid_json.certain = false;
        } else {
          cid_json.certain = true;
        }
        cid_json.receive_hash = hashes[i];
        cid_json.rep = rep;
        if (!tracking[rep]) {
          cid_json.quantity = 1;
          tracking[rep] = cid_json;
        } else {
          cid_json.quantity = tracking[rep].quantity+1;
          tracking[rep] = cid_json;
        }
      }
    } else if (account_history[i].subtype == "send") {
      //send not correct
      let rep = account_history[i].contents.representative;
      let pub_key_hash = bananojs.getAccountPublicKey(rep);
      let mint_block = await get_block_hash(pub_key_hash);
      if (!mint_block) {
        continue;
      }
      rep = mint_block.contents.representative;
      let cid_json = await is_valid_cidaccount(rep);
      //this means nft has been sent. remove it
      if (cid_json) {
        tracking[rep].quantity = tracking[rep].quantity-1;
        if (tracking[rep].quantity === 0) {
          delete tracking[rep];
        }
      }
      continue;
    }
  }
  for (let j=0; j < Object.keys(tracking).length; j++) {
    let nft = tracking[Object.keys(tracking)[j]];
    nfts.push(nft);
  }
  return nfts;
}

async function get_nft_info(account) {
  let validation_info = bananojs.getBananoAccountValidationInfo(account);
  if (!validation_info.valid) {
    return false;
  }
  if (nft_cache[account]) {
    return nft_cache[account];
  }
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
  let return_value = [cid_json, {
    major_version: major_version,
    minor_version: minor_version,
    patch_version: patch_version,
    max_supply: max_supply
  }];
  if (!nft_cache[account]) {
    nft_cache[account] = return_value;
  }
  return return_value;
}

module.exports = {
  account_to_cid: account_to_cid,
  get_cid_json: get_cid_json,
  get_account_history: get_account_history,
  is_valid_cidaccount: is_valid_cidaccount,
  get_block_hash: get_block_hash,
  get_block_hashes: get_block_hashes,
  get_nfts_for_account: get_nfts_for_account,
  get_nft_info: get_nft_info,
  verified_minters: verified_minters
}