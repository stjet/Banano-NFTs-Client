const util = require('./nft_util.js');
const express = require('express');
const nunjucks = require('nunjucks');

nunjucks.configure('templates', { autoescape: true });

const app = express();

app.use(express.static('static'));

app.get('/account/:account', async function (req, res) {
  let account = req.params.account;
  let nfts;
  try {
    nfts = await util.get_nfts_for_account(account);
  } catch (e) {
    console.log(e)
    return res.send('Error');
  }
  return res.send(nunjucks.render('account.html', {nfts: nfts, account: account}));
});

app.get('/nft/:account', async function (req, res) {
  let account = req.params.account;
  let info = await util.get_nft_info(account);
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

app.listen(8081, () => {
  console.log('Running')
});