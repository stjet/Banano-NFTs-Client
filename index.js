const util = require('./nft_util.js');
const captcha = require('./captcha.js');
const express = require('express');
const nunjucks = require('nunjucks');
const bodyParser = require('body-parser');
const giveaway = require('./storage/giveaway.js');
const nftee = require('./storage/nftee.js');
const aliases = require('./storage/aliases.js');
const cors = require('cors');

let outage = false;

nunjucks.configure('templates', { autoescape: true });

const app = express();

//allow all sites
//can change to `cors({ origin: ["https://hellomokuzai.github.io", "https://creeper.banano.cc"] })`
app.use(cors());

app.use(express.static('static'));

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.get('/account/:account', async function (req, res) {
  let account = req.params.account;
  if (!util.is_valid_account(account)) {
    let address = aliases.get_alias(account);
    if (!address) {
      return res.status(404).send('Error: 404 Page Not Found');
    } else {
      return res.redirect('/account/'+address);
    }
  }
  let supporter = false;
  try {
    //1 for true
    supporter = await util.account_is_supporting(account);
  } catch(e) {
    console.log(e);
    console.log(account);
  }
  let pending_nft_tx;
  if (supporter) {
    try {
      pending_nft_tx = await util.get_pending_nfts(account);
      if (pending_nft_tx.length === 0) {
        pending_nft_tx = undefined;
      } else {
        pending_nft_tx = JSON.stringify(pending_nft_tx);
      }
    } catch (e) {
      console.log(e);
      console.log(account);
    }
  }
  let nfts;
  try {
    nfts = await util.get_nfts_for_account(account, {detect_change_send: req.query.detect_change_send === "1", offset: Number(req.query.offset) || false, supporting: supporter, recursive: false});
  } catch (e) {
    console.log(e);
    return res.status(500).send('Error');
  }
  let supported_providers = ['ipfs.io', 'gateway.ipfs.io', 'cloudflare-ipfs.com', 'ipfs.eth.aragon.network', 'ipfs.fleek.co', 'nftstorage.link', 'http://ipfs.atomichub.io', 'http://ipfs.anonymize.com', 'gateway.pinata.cloud'];
  let fast_providers = ['gateway.ipfs.io', 'nftstorage.link']
  let provider = req.query.provider;
  //only approved providers
  if (!provider || !supported_providers.includes(provider)) {
    provider = "gateway.pinata.cloud";
    if (nfts.length > 2) {
      //if more than 2 nfts, dont use pinata, use a random other provider
      provider = fast_providers[Math.floor(Math.random()*fast_providers.length)];
    }
  }
  return res.send(nunjucks.render('account.html', {nfts: nfts, account: account, lang: req.acceptsLanguages(['es']), supporter: supporter, provider: provider, pending_nft_tx: pending_nft_tx}));
});

app.get('/nft/:account', async function (req, res) {
  let account = req.params.account;
  let info;
  try {
    info = await util.get_nft_info(account);
  } catch (e) {
    console.log(e);
    console.log(account);
    return res.status(500).send('Error');
  }
  if (!info) {
    console.log(info)
    return res.status(500).send('Error');
  }
  let cid_json = info[0];
  let supply_info = info[1];
  let v1_cid = false;
  if (req.query.v1_cid == "1") {
    try {
      if (cid_json.animation_url) {
        v1_cid = await util.v0_to_v1(cid_json.animation_url);
      } else if (cid_json.image) {
        v1_cid = await util.v0_to_v1(cid_json.image);
      }
    } catch (e) {
      v1_cid = false;
    }
  }
  let verified = util.verified_minters.includes(cid_json.properties.issuer);
  return res.send(nunjucks.render('nft.html', {cid_json: cid_json, supply_info: supply_info, verified: verified, lang: req.acceptsLanguages(['es']), v1_cid: v1_cid}));
});

app.get('/mint', function (req, res) {
  return res.sendFile('mint.html', {root: 'serve'});
});

app.get('/support', function (req, res) {
  return res.sendFile('support.html', {root: 'serve'});
});

app.get('/drop/:id', async function (req, res) {
  let info;
  try {
    info = await giveaway.get_giveaway_info(req.params.id);
  } catch (e) {
    console.log(e);
    return res.status(500).send('Error');
  }
  if (!info) {
    //return error
    return res.send(nunjucks.render('giveaway.html', {error: true, lang: req.acceptsLanguages(['es'])}));
  }
  return res.send(nunjucks.render('giveaway.html', {error: false, info: info, lang: req.acceptsLanguages(['es'])}));
});

app.post('/api/spyglass/hashes', async function (req, res) {
  //make sure comes from same site
  if (req.get('host') != "bannfts.prussiafan.club" || !req.body) {
    //should instead return forbidden
    return res.status(500);
  }
  //req.body
  let history = await util.get_block_hashes(req.body.blocks);
  res.setHeader('Content-Type', 'application/json');
  return res.send(JSON.stringify(history));
});

app.get('/alias/:alias', function (req, res) {
  let address = aliases.get_alias(req.params.alias);
  if (!address) {
    return res.status(404).send('Error: 404 Page Not Found');
  } else {
    return res.redirect('/account/'+address);
  }
});

//api
app.get('/api/v1/account/:account', async function (req, res) {
  return res.json(await util.get_nfts_for_account(req.params.account));
});

app.get('/api/v1/verified', function (req, res) {
  return res.json(util.verified_minters);
});

app.get('/api/v1/v0_to_v1_cid/:v0_cid', async function (req, res) {
  try {
    return res.send(await util.v0_to_v1(req.params.v0_cid));
  } catch (e) {
    return res.send("Error");
  }
});

app.get('/nftee/:id', async function (req, res) {
  let info;
  try {
    info = await nftee.get_nftee_info(req.params.id);
  } catch (e) {
    console.log(e);
    return res.status(500).send('Error');
  }
  if (!info) {
    //return error
    return res.send(nunjucks.render('nftee.html', {error: true, lang: req.acceptsLanguages(['es']), sent: false}));
  }
  let challenge_url, challenge_code, challenge_nonce;
  try {
    [challenge_url, challenge_code, challenge_nonce] = await captcha.req();
  } catch (e) {
    return res.status(500).send('Captcha Loading Error');
  }
  return res.send(nunjucks.render('nftee.html', {
    error: false, info: info, lang: req.acceptsLanguages(['es']), sent: false, challenge_url: challenge_url, challenge_code: challenge_code, challenge_nonce: challenge_nonce
  }));
});

app.post('/nftee/:id', async function (req, res) {
  try {
    let success = await captcha.verify(req.body);
    if (!success) {
      return res.send(nunjucks.render('nftee.html', {error_msg: "Captcha failed"}));
    }
  } catch (e) {
    return res.status(500).send('Captcha Verifying Error');
  }
  let info;
  let tx;
  try {
    info = await nftee.get_nftee_info(req.params.id);
    tx = await nftee.send_nftee(req.body.to_address, info.nft_rep);
  } catch (e) {
    console.log(e);
    return res.status(500).send('Error');
  }
  return res.send(nunjucks.render('nftee.html', {error: false, info: info, lang: req.acceptsLanguages(['es']), sent: true, sent_tx: tx, to_address: req.body.to_address}));
});

app.listen(443, async () => {
  try {
    await util.set_online_reps();
  } catch (e) {
    console.log(e);
    outage = true;
  }
  console.log('Running');
});