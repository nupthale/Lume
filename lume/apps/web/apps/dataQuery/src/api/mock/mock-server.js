import express from 'express';
import mock from './mock-data.js';

const app = express();
const port = 3210;

const server = app.listen(port, () => console.log(`server is listening ${port}`));

app.get('/*', (req, res) => {
    const key = `${req.method} ${req.path}`;
    res.json(mock[key]);
});
