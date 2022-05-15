const util = require('./nft_util.js');
const express = require('express');
const nunjucks = require('nunjucks');
const bodyParser = require('body-parser');
const giveaway = require('./giveaway.js');

nunjucks.configure('templates', { autoescape: true });

const app = express();

app.use(express.static('static'));

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.get('/account/:account', async function (req, res) {
  let account = req.params.account;
  let nfts;
  try {
    nfts = await util.get_nfts_for_account(account);
  } catch (e) {
    console.log(e);
    return res.send('Error');
  }
  return res.send(nunjucks.render('account.html', {nfts: nfts, account: account}));
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
  return res.send(nunjucks.render('nft.html', {cid_json: cid_json, supply_info: supply_info, verified: verified }));
});

app.get('/mint', function (req, res) {
  return res.sendFile('mint.html', {root: 'serve'});
});

app.get('/drop/:id', async function (req, res) {
  let infos;
  try {
    infos = await giveaway.get_giveaway_info(req.params.id);
  } catch (e) {
    console.log(e);
    return res.send('Error');
  }
  if (!infos) {
    //return error
    return res.send(nunjucks.render('giveaway.html', {error: true}));
  }
  return res.send(nunjucks.render('giveaway.html', {error: false, info: infos[0]}));
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

app.listen(8081, async () => {
  await util.set_online_reps();
  console.log('Running')
});