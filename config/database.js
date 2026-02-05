const mongoose = require('mongoose');

// Configuration MongoDB
const MONGODB_URI = 'mongodb+srv://rakotoniainalahatra3_db_user:N5HBAiAKSHVdCg2G@cluster0.gzeshjm.mongodb.net/speaktostranger?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
    console.log('✅ Connecté à MongoDB');
});

module.exports = db;
