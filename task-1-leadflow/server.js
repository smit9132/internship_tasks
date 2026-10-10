require('dotenv').config();

const app = require('./app');
const connectDB = require('./config/db');

const port = Number(process.env.PORT) || 3000;

async function startServer() {
  try {
    await connectDB();
    app.listen(port, () => {
      console.log(`LeadFlow server listening on port ${port}.`);
    });
  } catch {
    process.exitCode = 1;
  }
}

startServer();
