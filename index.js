const util = require('./nft_util.js');
const express = require('express');
const nunjucks = require('nunjucks');
const bodyParser = require('body-parser');
const giveaway = require('./storage/giveaway.js');
const aliases = require('./storage/aliases.js');

let outage = false;

nunjucks.configure('templates', { autoescape: true });

const app = express();

app.use(express.static('static'));

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.get('/account/:account', async function (req, res) {
  let account = req.params.account;
  if (!util.is_valid_account(account)) {
    let address = aliases.get_alias(account);
    if (!address) {
      return res.status(404).send('Error');
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
      console.log(e)
    }
  }
  let nfts;
  try {
    nfts = await util.get_nfts_for_account(account, {detect_change_send: req.query.detect_change_send, supporter: supporter});
  } catch (e) {
    console.log(e);
    return res.status(500).send('Error');
  }
  return res.send(nunjucks.render('account.html', {nfts: nfts, account: account, lang: req.acceptsLanguages(['es']), supporter: supporter, pending_nft_tx: pending_nft_tx}));
});

app.get('/nft/:account', async function (req, res) {
  let account = req.params.account;
  let info;
  try {
    info = await util.get_nft_info(account);
  } catch (e) {
    console.log(e);
    return res.send('Error');
  }
  if (!info) {
    return res.send('Error');
  }
  let cid_json = info[0];
  let supply_info = info[1];
  let verified = util.verified_minters.includes(cid_json.properties.issuer);
  return res.send(nunjucks.render('nft.html', {cid_json: cid_json, supply_info: supply_info, verified: verified, lang: req.acceptsLanguages(['es'])}));
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
    return res.status(404).send('Error');
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

app.listen(443, async () => {
  try {
    await util.set_online_reps();
  } catch (e) {
    console.log(e);
    outage = true;
  }
  console.log('Running');
});