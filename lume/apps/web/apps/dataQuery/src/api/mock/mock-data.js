import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import path from 'path';
import { fileURLToPath } from 'url';

import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mock = {};

const reportDir = path.resolve(__dirname, './src/mock');
fs.readdirSync(reportDir)
  .filter(file => file.endsWith(".json"))
  .forEach(file => {
    Object.assign(mock, require(path.resolve(reportDir,file)));
  });

const sysDir = path.resolve(__dirname, './sys');
fs.readdirSync(sysDir)
  .filter(file => file.endsWith(".json"))
  .forEach(file => {
    Object.assign(mock, require(path.resolve(sysDir,file)));
  });  

export default mock;
  