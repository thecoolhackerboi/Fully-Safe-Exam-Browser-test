const https = require('https');
const fs = require('fs');

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve({ res, data: Buffer.concat(data) }));
    }).on('error', reject);
  });
}

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ res, data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const { res: res1, data: html1 } = await get('https://safeexambrowser.moodle.ch/lms/login/index.php');
  const cookies = (res1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const tokenMatch = /name="logintoken" value="([^"]+)"/.exec(html1.toString());
  const token = tokenMatch ? tokenMatch[1] : '';

  const postData = 'username=seb1&password=demo&logintoken=' + encodeURIComponent(token);
  const { res: res2 } = await post('https://safeexambrowser.moodle.ch/lms/login/index.php', postData, {
    'Cookie': cookies
  });
  const cookies2 = (res2.headers['set-cookie'] || []).map(c => c.split(';')[0]).concat([cookies]).join('; ');

  const { res: res3, data: sebData } = await get('https://safeexambrowser.moodle.ch/lms/mod/quiz/accessrule/seb/config.php?cmid=9259', {
    'Cookie': cookies2
  });
  console.log('Config status:', res3.statusCode, 'Length:', sebData.length);
  console.log('Headers:', res3.headers);
  fs.writeFileSync('D:/Projects/FSEB/scripts/quiz-config.seb', sebData);
}
main().catch(console.error);
