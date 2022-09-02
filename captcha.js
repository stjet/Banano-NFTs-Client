const fetch = require('node-fetch');

//captcha functions should take in the request body, then return a bool to see if captcha was successful

async function req() {
  //get
  let resp = await fetch('https://captcha.prussia.dev/captcha', {method: 'GET'});
	resp = await resp.json();
  challenge_url = 'https://captcha.prussia.dev/challenge/'+resp.image+"?nonce="+resp.nonce;
  challenge_code = resp.code;
  challenge_nonce = resp.nonce;
  return [challenge_url, challenge_code, challenge_nonce];
}

async function verify(req_body) {
  let code = req_body['code'];
  let nonce = req_body['nonce'];
  let guess = req_body['answer'];
  let params = new URLSearchParams();
  params.append('code', code);
  params.append('nonce', nonce);
  params.append('guess', guess);
  let resp = await fetch('https://captcha.prussia.dev/captcha', {method: 'POST', body: params});
  resp = await resp.json();
  return resp['success'];
}

module.exports.req = req;
module.exports.verify = verify;