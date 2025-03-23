// server.js
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Database setup
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: false
});

// Sound model
const Sound = sequelize.define('Sound', {
  filename: {
    type: DataTypes.STRING,
    allowNull: false
  },
  url: {
    type: DataTypes.STRING,
    allowNull: false
  },
  lat: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  lng: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  mimetype: {
    type: DataTypes.STRING,
    allowNull: false
  },
  size: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
});

// Initialize database
(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ force: false });
    console.log('Database connected and synced');
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
})();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File upload configuration
const uploadDir = path.join(__dirname, process.env.UPLOAD_DIR || 'uploads');
const createUploadDir = async () => {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
  } catch (error) {
    console.error('Error creating upload directory:', error);
  }
};
createUploadDir();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const extension = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${extension}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/webm'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only audio files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

// Routes
app.post('/api/recordings', upload.single('audio'), async (req, res) => {
  try {
    const { lat, lng } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    if (!lat || !lng) {
      await fs.unlink(req.file.path);
      return res.status(400).json({ error: 'Missing coordinates' });
    }

    const recording = await Sound.create({
      filename: req.file.filename,
      url: `/uploads/${req.file.filename}`,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    res.status(201).json(recording);
  } catch (error) {
    console.error('Upload error:', error);
    if (req.file) await fs.unlink(req.file.path);
    res.status(500).json({ error: 'Failed to save recording' });
  }
});

app.get('/api/recordings', async (req, res) => {
  try {
    const { lat, lng, radius=0.25 } = req.query;

    
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Missing coordinates' });
    }

    const latitude = parseFloat(lat) || 0;
    const longitude = parseFloat(lng) || 0;
    const searchRadius = parseFloat(radius) || 0.5; // Default 0.5 km (500m)

    // Haversine formula for distance calculation
    const recordings = await sequelize.query(`
  SELECT * FROM (
    SELECT *, 
    (6371 * acos(
      cos(radians(:latitude)) 
      * cos(radians(lat)) 
      * cos(radians(lng) - radians(:longitude)) 
      + sin(radians(:latitude)) 
      * sin(radians(lat))
    )) AS distance
    FROM Sounds
  ) AS subquery
  WHERE distance < :radius
  ORDER BY distance
  LIMIT 100

    `, {
      replacements: { latitude, longitude, radius: searchRadius / 1000 },
      type: Sequelize.QueryTypes.SELECT
    //  model: Sound,
      //mapToModel: true
    });

    res.json(recordings);
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch recordings' });
  }
});

// Static files
app.use('/uploads', express.static(uploadDir, {
  setHeaders: (res, path) => {
    if (path.endsWith('.webm')) {
      res.set('Content-Type', 'audio/webm');
    }
  }
}));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
