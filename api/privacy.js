const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, '../public/privacy.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
};
