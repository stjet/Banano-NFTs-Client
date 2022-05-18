const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

bananocoinBananojs.setBananodeApiUrl('https://kaliumapi.appditto.com/api');

/*
async function get_account_history(account, receive_only=false, send_only=false, count=100) {
  let payload = {
    address: account,
    count: String(count)
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
  let resp = await fetch('https://api.spyglass.pw/banano/v1/account/confirmed-transactions', {method: 'POST', body: payload, headers: {'Content-Type': 'application/json'}});
  return await resp.json();
}
*/

async function get_account_history(account, receive_only=false, count=150) {
  let resp = await bananocoinBananojs.getAccountHistory(account,count=count);
  let history = resp.history;
  if (receive_only) {
    return history.filter(function(item) {
      return item.type === "receive";
    });
  } else {
    return history;
  }
}

async function get_block_hash(hash) {
  let resp = await fetch('https://api.spyglass.pw/banano/v1/block/'+hash);
  return await resp.json();
}

//hashes: array of hash
async function get_block_hashes(hashes) {
  //limit 500
  let resp = await fetch("https://bannfts.prussiafan.club/api/spyglass/hashes", {method: 'POST', body: JSON.stringify({blocks: hashes}), headers: {'Content-Type': 'application/json'}});
  //let resp = await fetch('https://api.spyglass.pw/banano/v1/blocks', {blocks: hashes});
  return await resp.json();
}

async function trace_ownership(receive_hash, nft_rep, nft_issuer) {
  //trace ownership
  let history = [];
  let loops = 0;
  while (true) {
    loops++;
    //get receive
    let receive_block = await get_block_hash(receive_hash);
    //find send
    let send_hash = receive_block.contents.link;
    let sent_from = receive_block.sourceAccount;
    //directly minted
    if (sent_from === nft_issuer) {
      history.push({
        type: "send (minted)",
        hash: send_hash,
        from: sent_from
      });
      break;
    } else {
      history.push({
        type: "send (transfer)",
        hash: send_hash,
        from: sent_from
      });
    }
    //if was a transfer and not a mint, find the next receive block
    let hashes = (await get_account_history(sent_from, receive_only=true)).map(function(item) {
      return item.hash;
    });
    await sleep(500);
    let account_history = await get_block_hashes(hashes);
    //iterate through account history
    let found = false;
    for (let i=0; i < account_history.length; i++) {
      //receive only, so check the rep of linked
      let send_hash = account_history[i].contents.link;
      await sleep(200);
      let send_block = await get_block_hash(send_hash);
      //all this is checking if the mint block is correct
      if (send_block.blockAccount !== nft_issuer) {
        let rep = send_block.contents.representative;
        let pub_key_hash = window.bananocoinBananojs.getAccountPublicKey(rep);
        let mint_block = await get_block_hash(pub_key_hash);
        if (mint_block.error) {
          continue;
        } else {
          receive_hash = hashes[i];
          rep = mint_block.contents.representative;
          found = true;
        }
      } else {
        rep = send_block.contents.representative;
      }
      if (nft_rep === rep) {
        receive_hash = hashes[i];
        found = true;
        break;
      }
      //WE NEED TO SET THE receive_hash
    }
    //unchanged, no relevant block found
    if (!found) {
      history.push({
        type: "unsure"
      });
      break;
    }
    //no more than 7 loops, that is too deep layer
    if (loops > 7) {
      history.push({
        type: "too deep"
      });
      break;
    }
  }
  return history;
}

async function show_ownership(receive_hash, nft_rep, nft_issuer) {
  document.getElementById("ownership-modal").style.display = "block";
  let history = await trace_ownership(receive_hash, nft_rep, nft_issuer);
  let ul = document.getElementById("ownership-history-seq");
  ul.innerHTML = "";
  //create items and append
  for (let i=0; i < history.length; i++) {
    let item = history[i];
    let li = document.createElement('LI');
    if (item.hash) {
      li.innerHTML = "<a href='https://yellowspyglass.com/hash/"+item.hash+"'>"+item.type+"</a> from "+item.from.slice(0,11)+"..."+item.from.slice(-7);
    } else {
      li.innerHTML = item.type;
    }
    ul.appendChild(li);
  }
}

//we need to convert the mint block hash into a rep
async function how_to_send(receive_hash, nft_issuer) {
  let receive_block = await get_block_hash(receive_hash);
  let send_rep;
  if (receive_block.sourceAccount === nft_issuer) {
    //the corresponding block is the mint block
    send_rep =  window.bananocoinBananojs.getAccount(receive_block.contents.link, "ban_");
  } else {
    //the corresponding block's rep is the mint block
    await sleep(1000);
    let send_block = await get_block_hash(receive_block.contents.link);
    send_rep = send_block.contents.representative;
  }
  //handoff to modal
  document.getElementById("how-send-modal").style.display = "block";
  document.getElementById('nft-send-rep').innerText = send_rep;
}

async function check_certainty() {
  //
}

function close_modal(id) {
  document.getElementById(id).style.display = 'none';
}