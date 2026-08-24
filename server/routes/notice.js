const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');

let pool;
function setPool(p) { pool = p; }

// 공지 작성·수정·삭제는 관리자만 할 수 있다.
// 이전에는 인증이 전혀 없어 누구나 공지를 지우거나 파일을 올릴 수 있었다.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '관리자만 공지를 관리할 수 있습니다.' });
  }
  next();
}

const uploadDir = path.join(__dirname, '../uploads/');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function removeUploadedImage(imageUrl) {
  if (!imageUrl || !String(imageUrl).startsWith('/uploads/')) return;
  const filePath = path.join(uploadDir, path.basename(imageUrl));
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.error('[notice] 업로드 이미지 삭제 실패:', err.message);
    }
  });
}

// 허용할 이미지 형식만 명시한다.
// 확장자를 업로드 파일 이름에서 그대로 가져오면 evil.html 을 image/png 로 위장해 올린 뒤
// /uploads/xxx.html 로 접근하는 저장형 XSS 가 가능해진다. 그래서 확장자는 서버가 정한다.
const ALLOWED_IMAGE_TYPES = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/gif':  '.gif',
  'image/webp': '.webp',
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // 파일명도 예측 불가능하게 만든다 (Math.random 은 추측 가능).
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    cb(null, unique + ALLOWED_IMAGE_TYPES[file.mimetype]);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
      return cb(new Error('jpg, png, gif, webp 이미지만 업로드할 수 있습니다.'));
    }
    cb(null, true);
  },
});

// [GET] 목록 조회
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM notices ORDER BY is_pinned DESC, created_at DESC'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: '조회 실패' });
  }
});

// [DELETE] 전체 삭제 (/:id 보다 위에 위치해야 함)
router.delete('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT image_url FROM notices WHERE image_url IS NOT NULL');
    await pool.query('DELETE FROM notices');
    await pool.query('ALTER TABLE notices AUTO_INCREMENT = 1');
    rows.forEach((row) => removeUploadedImage(row.image_url));
    res.json({ message: '모든 공지가 삭제되었습니다.' });
  } catch (error) {
    res.status(500).json({ error: '전체 삭제 실패' });
  }
});

// [POST] 공지 등록
router.post('/', requireAuth, requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { title, content, type, is_pinned } = req.body;
    const image_url = req.file ? `/uploads/${req.file.filename}` : null;
    await pool.query(
      'INSERT INTO notices (title, content, type, is_pinned, image_url) VALUES (?, ?, ?, ?, ?)',
      [title, content, type, is_pinned ?? 0, image_url]
    );
    res.status(201).json({ message: '등록 완료' });
  } catch (error) {
    res.status(500).json({ error: '등록 실패' });
  }
});

// [PUT] 공지 수정
router.put('/:id', requireAuth, requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, type, is_pinned } = req.body;
    let image_url = req.body.image_url || null;
    const [[existing]] = await pool.query('SELECT image_url FROM notices WHERE id = ?', [id]);
    if (req.file) image_url = `/uploads/${req.file.filename}`;
    await pool.query(
      'UPDATE notices SET title = ?, content = ?, type = ?, is_pinned = ?, image_url = ? WHERE id = ?',
      [title, content, type, is_pinned ?? 0, image_url, id]
    );
    if (req.file && existing?.image_url && existing.image_url !== image_url) {
      removeUploadedImage(existing.image_url);
    }
    res.json({ message: '수정 완료' });
  } catch (error) {
    res.status(500).json({ error: '수정 실패' });
  }
});

// [DELETE] 낱개 삭제
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[existing]] = await pool.query('SELECT image_url FROM notices WHERE id = ?', [req.params.id]);
    await pool.query('DELETE FROM notices WHERE id = ?', [req.params.id]);
    removeUploadedImage(existing?.image_url);
    res.json({ message: '삭제 완료' });
  } catch (error) {
    res.status(500).json({ error: '삭제 실패' });
  }
});

router.use((err, req, res, next) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '이미지는 3MB 이하만 업로드할 수 있습니다.' });
  }
  return res.status(400).json({ error: err.message || '이미지 업로드 실패' });
});

module.exports = { router, setPool };
