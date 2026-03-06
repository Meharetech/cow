const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Create subdirectories based on fieldname
        const subDir = path.join(uploadDir, file.fieldname);
        if (!fs.existsSync(subDir)) {
            fs.mkdirSync(subDir, { recursive: true });
        }
        cb(null, subDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// Allowed file extensions and MIME types
const allowedExtensions = new Set(['.jpeg', '.jpg', '.png', '.gif', '.webp', '.pdf', '.mp4', '.mov', '.avi', '.mkv', '.3gp']);
const allowedMimeTypes = new Set([
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
    'video/3gpp', 'video/avi', 'video/mov',
    'application/pdf'
]);

// File filter
const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isExtAllowed = allowedExtensions.has(ext);
    const isMimeAllowed = allowedMimeTypes.has(file.mimetype);

    if (isExtAllowed || isMimeAllowed) {
        return cb(null, true);
    } else {
        cb(new Error(`File type not allowed. Received: ${file.mimetype} (${ext}). Only images, videos and PDFs are supported.`));
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    },
    fileFilter: fileFilter
});

module.exports = upload;
