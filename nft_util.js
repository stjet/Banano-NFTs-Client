//"use strict";
const bananojs = require('@bananocoin/bananojs');
const base58 = require('base-58');
const fs = require('fs');
const axios = require('axios');
const CID = require('cids');

bananojs.setBananodeApiUrl('https://kaliumapi.appditto.com/api');

const base_url = "https://gateway.pinata.cloud/ipfs/";

let online_reps;

let account_nft_cache = {};
let nft_cache = {};
let invalid_rep_mint_blocks = [];
let block_cache = {};
let supporting_cache = [];
//let owners_cache = {};
//cache should store nfts and block height at snapshot. If block height is unchanged, keep using cache
//let account_history_cache = {};

//check outgoing transactions. If this detected in send, all previously returned nfts are not in wallet
//check ingoing transactions. If received here, this is painful and will be implemented later
const SEND_ALL_REP = "ban_1senda11nfts1111111111111111111111111111111111111111rtbtxits";

let verified_minters = String(fs.readFileSync('verified_minters.txt')).split('\n').map(function(item) {
  return item.trim();
});

let api_secret = process.env.spyglass_key;

async function set_online_reps() {
  let resp = await axios.get('https://api.spyglass.pw/banano/v1/representatives/online', {headers: {'Authorization': api_secret}});
  online_reps = resp.data;
}


function is_valid_account(account) {
  return bananojs.getBananoAccountValidationInfo(account).valid;
}

async function get_block_height(account) {
  let info = await bananojs.getAccountInfo(account);
  return info.confirmation_height;
}

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

//async function get_account_history(account, receive_only=false, send_only=false, count=120, from=false) {
async function get_account_history(account, options={receive_only: false, send_only: false, count: 120, from: false, offset: false}) {
  let payload = {
    address: account,
    size: String(options.count)
  };
  if (options.receive_only && options.send_only) {
    payload.includeChange = false;
  } else if (options.receive_only) {
    payload.includeChange = false;
    payload.includeSend = false;
  } else if (options.send_only) {
    payload.includeChange = false;
    payload.includeReceive = false;
  }
  if (options.offset) {
    payload.offset = String(options.offset);
  }
  if (options.from) {
    payload.filterAddresses = options.from;
  }
  let resp = await axios.post('https://api.spyglass.pw/banano/v2/account/confirmed-transactions', payload, {headers: {'Authorization': api_secret}});
  return resp.data;
}

async function is_valid_cidaccount(account) {
  //check for unopened
  //it must be unopened
  try {
    let ah = await get_account_history(account);
    //v2 error handling
    if (ah.length !== 0) {
      return false;
    }
  } catch (e) {
  }
  if (online_reps.includes(account)) {
    return false;
  }
  let cid_json = await get_cid_json(account_to_cid(account));
  if (!cid_json) {
    return false;
  }
  return cid_json;
}

async function get_block_hash(hash) {
  //block_cache
  if (block_cache[hash] !== undefined) {
    return block_cache[hash];
  }
  let resp;
  try {
    resp = await axios.get('https://api.spyglass.pw/banano/v1/block/'+hash, {headers: {'Authorization': api_secret}});
    block_cache[hash] = resp.data;
  } catch (e) {
    block_cache[hash] = false;
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

async function get_supply_block_rep(hash) {
  let supply_block = await get_block_hash(hash);
  let supply_rep = supply_block.contents.representative;
  //decode the info from supply rep
  if (!supply_rep.startsWith('ban_1nftsupp1y11111')) {
    return false;
  }
  let pub_key = bananojs.getAccountPublicKey(supply_rep);
  return [supply_block, pub_key];
}

//if possible, maybe cache the supply block heights?
async function within_supply_constraints(supply_hash, mint_height) {
  //see height of supply, height of mint block. Get supply, check. Obviously, account may put out supply block, and not until much later, so it is not decisive. But if returns true, there is certainty
  /*
  if (mint_block.height < supply_block.height) {
    //supply block minted mint block??? 
  }
  */
  let supply_info = await get_supply_block_rep(supply_hash);
  let supply = parseInt(supply_info[1].slice(48, 64), 16);
  if (supply === 0) {
    return true;
  }
  let height_diff = mint_height - supply_info[0].height;
  if (height_diff > supply) {
    return false;
  } else {
    return true;
  }
}

async function get_nfts_for_account(account, options={detect_change_send: false, offset: false, supporting: false, recursive: false}) {
  if (options.detect_change_send) {
    console.log('detect_change_send');
  }
  let block_height = await get_block_height(account);
  //dont use cache if offset is used
  //this means !0 == true which is what we want, because 0 offset means no offset
  if (account_nft_cache[account] && !options.offset) {
    if (account_nft_cache[account].block_height == block_height) {
      return account_nft_cache[account].nfts;
    }
  }
  let validation_info = bananojs.getBananoAccountValidationInfo(account);
  if (!validation_info.valid) {
    return false;
  }
  let nfts = [];
  let account_history;
  try {
    if (verified_minters.includes(account)) {
      //include changes
      //detect_change_send is true, essentially
      if (options.supporting) {
        account_history = await get_account_history(account, {count: 400, offset: options.offset});
      } else {
        account_history = await get_account_history(account, {count: 120, offset: options.offset});
      }
    } else {
      if (options.supporting) {
        account_history = await get_account_history(account, {receive_only: true, send_only: true, count: 400, offset: options.offset});
      } else {
        account_history = await get_account_history(account, {receive_only: true, send_only: true, offset: options.offset, count: 120});
      }
    }
  } catch (e) {
    console.log(e)
    return nfts;
  }
  //spyglass v2 fix
  if (account_history.length === 0) {
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
  //mint block optimizations not possible currently
  //start actual tracking
  let tracking = {};
  for (let i=0; i < account_history.length; i++) {
    if (account_history[i].subtype == "receive") {
      //let send_block = await get_block_hash(account_history[i].contents.link);
      let send_block_hash_index = send_block_hashes.indexOf(account_history[i].contents.link);
      let send_block = corresponding_send_blocks[send_block_hash_index];
      let rep;
      let mint_height;
      //checks if nft comes directly from a verified minter
      if (!verified_minters.includes(account_history[i].sourceAccount)) {
        let send_b_rep = send_block.contents.representative;
        //skip online reps
        if (online_reps.includes(send_b_rep)) {
          continue;
        }
        if (invalid_rep_mint_blocks.includes(send_b_rep)) {
          continue;
        }
        if (send_b_rep === SEND_ALL_REP && !options.recursive) {
          //use offset and size to get nfts of account at the time
          let sender_block_height = await get_block_height(account_history[i].sourceAccount);
          let all_sent_nfts = await get_nfts_for_account(account_history[i].sourceAccount, {
            detect_change_send: options.detect_change_send, offset: sender_block_height-send_block.height+1, supporting: false, recursive: true
          });
          nfts = [].concat(all_sent_nfts, nfts);
        }
        let pub_key_hash = bananojs.getAccountPublicKey(send_b_rep);
        //most of the requests are from here
        let mint_block = await get_block_hash(pub_key_hash);
        if (!mint_block) {
          invalid_rep_mint_blocks.push(send_b_rep);
          continue;
        }
        rep = mint_block.contents.representative;
        mint_height = mint_block.height;
      } else {
        rep = send_block.contents.representative;
        if (rep === SEND_ALL_REP && !options.recursive) {
          //use offset and size to get nfts of account at the time
          let sender_block_height = await get_block_height(account_history[i].sourceAccount);
          let all_sent_nfts = await get_nfts_for_account(account_history[i].sourceAccount, {
            detect_change_send: options.detect_change_send, offset: sender_block_height-send_block.height+1, supporting: false, recursive: true
          });
          nfts = [].concat(all_sent_nfts, nfts);
        }
        mint_height = send_block.height;
        if (options.detect_change_send) {
          let send_b_rep = send_block.contents.representative;
          //skip online reps
          if (online_reps.includes(send_b_rep)) {
            continue;
          }
          if (invalid_rep_mint_blocks.includes(send_b_rep)) {
            continue;
          }
          let pub_key_hash = bananojs.getAccountPublicKey(send_b_rep);
          //most of the requests are from here
          let mint_block = await get_block_hash(pub_key_hash);
          if (mint_block) {
            rep = mint_block.contents.representative;
          }
        }
      }
      let cid_json = await is_valid_cidaccount(rep);
      if (cid_json) {
        if (!verified_minters.includes(account_history[i].sourceAccount)) {
          //we may have to trace ownership here. prefer not to do this. instead we have certainty and uncertainty
          //certainty should also be checked with the supply
          cid_json.certain = false;
        } else {
          cid_json.certain = true;
        }
        let within_supply_confident = await within_supply_constraints(cid_json.properties.supply_block_hash, mint_height);
        if (!within_supply_confident) {
          cid_json.certain = false;
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
      if (online_reps.includes(rep)) {
        continue;
      }
      if (rep === SEND_ALL_REP) {
        console.log("send all!", account);
        //clear tracking, because send all rep means all nfts are sent
        tracking = {};
        continue;
      }
      if (invalid_rep_mint_blocks.includes(rep)) {
        continue;
      }
      let pub_key_hash = bananojs.getAccountPublicKey(rep);
      let mint_block = await get_block_hash(pub_key_hash);
      if (!mint_block) {
        invalid_rep_mint_blocks.push(rep);
        continue;
      }
      rep = mint_block.contents.representative;
      let cid_json = await is_valid_cidaccount(rep);
      //this means nft has been sent. remove it
      if (cid_json) {
        if (!tracking[rep]) {
          console.log('nft sent but never existed in account. hmm')
          //shouldnt happen... but whatever
          continue;
        }
        tracking[rep].quantity = tracking[rep].quantity-1;
        if (tracking[rep].quantity === 0) {
          delete tracking[rep];
        }
      }
      continue;
    } else if (account_history[i].subtype == "change") {
      //check if minted nft to self
      let rep = account_history[i].contents.representative;
      let cid_json = await is_valid_cidaccount(rep);
      if (cid_json) {
        let within_supply_confident = await within_supply_constraints(cid_json.properties.supply_block_hash, account_history[i].height);
        if (!within_supply_confident) {
          cid_json.certain = false;
        } else {
          cid_json.certain = true;
        }
        cid_json.rep = rep;
        cid_json.receive_hash = hashes[i];
        if (!tracking[rep]) {
          cid_json.quantity = 1;
          tracking[rep] = cid_json;
        } else {
          tracking[rep] = cid_json;
        }
      }
    }
  }
  for (let j=0; j < Object.keys(tracking).length; j++) {
    let nft = tracking[Object.keys(tracking)[j]];
    nfts.push(nft);
  }
  //this means !0 == true which is what we want, because 0 offset means no offset
  if (!options.offset) {
    account_nft_cache[account] = {nfts: nfts, block_height: await get_block_height(account)};
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
  let pub_key = await get_supply_block_rep(cid_json.properties.supply_block_hash);
  pub_key = pub_key[1];
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

async function get_pending_transactions(account) {
  let resp = await axios.post('https://api.spyglass.pw/banano/v1/account/receivable-transactions', {address: account}, {headers: {'Authorization': api_secret}});
  return resp.data;
}

//only call when premium requested
async function account_is_supporting(account) {
  //ik the === true is not needed, this is just for readability
  if (supporting_cache.includes(account)) {
    return true;
  }
  let dev_fund = "ban_3pdripjhteyymwjnaspc5nd96gyxgcdxcskiwwwoqxttnrncrxi974riid94";
  let account_history = await get_account_history(account, {send_only: true, count: 150, from: [dev_fund]});
  //filter account_history
  for (let i=0; i < account_history.length; i++) {
    let block = account_history[i];
    if (block.amount >= 800) {
      supporting_cache.push(account);
      return true;
    }
  }
  return false;
}

//premium features
//get only block hash of pending, not pending nft info
async function get_pending_nfts(account) {
  let pending = await get_pending_transactions(account);
  let likely_txs = [];
  //change pending to hashes, get hashes
  //pending =
  for (let i=0; i < pending.length; i++) {
    let transaction = pending[i];
    //check if rep is abnormal and from verified minters
    //if so add tx
    if (verified_minters.includes(transaction.address)) {
      likely_txs.push(transaction.hash);
    }
  }
  return likely_txs;
}

async function get_mint_number(mint_hash) {
  //get mint_hash's transaction
  //get block height of supply block
  //get transactions offset by current height and mint hash's height, with the size being the difference in heights of supply and mint hash's
  //check representatives of all transactions in between
  //count, return count
}

module.exports = {
  v0_to_v1: v0_to_v1,
  account_to_cid: account_to_cid,
  get_cid_json: get_cid_json,
  get_account_history: get_account_history,
  is_valid_cidaccount: is_valid_cidaccount,
  get_block_hash: get_block_hash,
  get_block_hashes: get_block_hashes,
  get_nfts_for_account: get_nfts_for_account,
  get_nft_info: get_nft_info,
  verified_minters: verified_minters,
  set_online_reps: set_online_reps,
  account_is_supporting: account_is_supporting,
  is_valid_account: is_valid_account,
  get_pending_nfts: get_pending_nfts
}