import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import Twilio from 'twilio';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PAGE_ID = process.env.FB_PAGE_ID || 'BanbungUttasahakamnukhroSchool';
const ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN || '';
const API_VERSION = 'v17.0';
const PORT = process.env.PORT || 3000;

const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || EMAIL_USER;
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM || '';

const emailTransporter = EMAIL_USER && EMAIL_PASS ? nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
}) : null;

const twilioClient = TWILIO_SID && TWILIO_TOKEN ? Twilio(TWILIO_SID, TWILIO_TOKEN) : null;

const samplePosts = [
  {
    id: 'sample-1',
    title: 'ตัวอย่างโพสต์กิจกรรมแนะนำ',
    desc: 'โพสต์ตัวอย่างสำหรับทดสอบระบบ หากไม่มี Facebook token ให้แสดงโพสต์ตัวอย่างนี้ก่อน',
    date: new Date().toISOString().slice(0, 10),
    images: ['https://via.placeholder.com/900x500?text=Sample+Activity'],
    facebook_link: 'https://www.facebook.com/BanbungUttasahakamnukhroSchool/',
    category: 'activity'
  },
  {
    id: 'sample-2',
    title: 'ข้อมูลสำคัญทั่วไปจากเพจโรงเรียน',
    desc: 'โพสต์ตัวอย่างอีกชิ้นที่ไม่เกี่ยวกับกิจกรรม เพื่อทดสอบการค้นหาและหมวดหมู่',
    date: new Date().toISOString().slice(0, 10),
    images: ['https://via.placeholder.com/900x500?text=Sample+News'],
    facebook_link: 'https://www.facebook.com/BanbungUttasahakamnukhroSchool/',
    category: 'other'
  }
];

app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/posts', async (req, res) => {
  if (!ACCESS_TOKEN) {
    return res.json({ data: samplePosts, warning: 'FB_ACCESS_TOKEN not set. Returning sample posts.' });
  }

  const url = `https://graph.facebook.com/${API_VERSION}/${PAGE_ID}/posts?fields=message,created_time,full_picture,permalink_url,attachments{subattachments,media,type,url}&limit=50&access_token=${ACCESS_TOKEN}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: 'Facebook API error', details: text });
    }

    const result = await response.json();
    const posts = (result.data || []).map(transformPost);
    return res.json({ data: posts });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/notify', async (req, res) => {
  const { name, email, phone, notifyEmail, notifySMS } = req.body;
  const warnings = [];
  const results = [];

  if (!notifyEmail && !notifySMS) {
    return res.status(400).json({ error: 'เลือก Email หรือ SMS อย่างน้อยหนึ่งช่องทาง' });
  }

  if (notifyEmail && !email) {
    return res.status(400).json({ error: 'กรุณาระบุอีเมลสำหรับการแจ้งเตือน' });
  }

  if (notifySMS && !phone) {
    return res.status(400).json({ error: 'กรุณาระบุเบอร์โทรศัพท์สำหรับ SMS' });
  }

  const message = `สวัสดี ${name || 'นักเรียน'}\n\nนี่เป็นการแจ้งเตือนจากระบบข่าวสารเพจโรงเรียนบ้านบึง \"อุตสาหกรรมนุเคราะห์\"\n\nหากคุณตั้งค่าการแจ้งเตือนสำเร็จ ระบบจะแจ้งเตือนเมื่อมีโพสต์ใหม่`;

  if (notifyEmail) {
    if (!emailTransporter) {
      warnings.push('Email ไม่ได้ตั้งค่า EMAIL_USER / EMAIL_PASS');
    } else {
      try {
        await emailTransporter.sendMail({
          from: EMAIL_FROM,
          to: email,
          subject: 'แจ้งเตือนข่าวสารโรงเรียน',
          text: message
        });
        results.push('email');
      } catch (error) {
        warnings.push(`ส่ง Email ไม่สำเร็จ: ${error.message}`);
      }
    }
  }

  if (notifySMS) {
    if (!twilioClient || !TWILIO_FROM) {
      warnings.push('SMS ไม่ได้ตั้งค่า Twilio หรือ TWILIO_FROM');
    } else {
      try {
        await twilioClient.messages.create({
          body: message,
          from: TWILIO_FROM,
          to: phone
        });
        results.push('sms');
      } catch (error) {
        warnings.push(`ส่ง SMS ไม่สำเร็จ: ${error.message}`);
      }
    }
  }

  const response = { success: true, sent: results, warnings };
  return res.json(response);
});

function transformPost(post) {
  const title = makeTitle(post.message);
  const desc = post.message || 'ไม่มีข้อความจากโพสต์';
  const date = post.created_time ? post.created_time.slice(0, 10) : '';
  const images = extractImages(post);
  return {
    id: post.id,
    title,
    desc,
    date,
    images,
    facebook_link: post.permalink_url || '',
    category: categorizePost(post.message)
  };
}

function makeTitle(message) {
  if (!message) return 'โพสต์จากเพจโรงเรียน';
  const firstLine = message.split('\n')[0].trim();
  if (firstLine.length <= 60) return firstLine;
  return firstLine.slice(0, 57).trim() + '...';
}

function categorizePost(message) {
  if (!message) return 'other';
  const text = message.toLowerCase();
  const activityKeywords = [
    'กิจกรรม', 'ประกวด', 'แข่งขัน', 'อบรม', 'ค่าย', 'ประชุม', 'ฝึกซ้อม', 'ทัศนศึกษา', 'สัมมนา', 'โครงการ', 'บูรณาการ', 'นิทรรศการ', 'จิตอาสา', 'ศึกษาดูงาน', 'เปิดบ้าน', 'แข่งขัน', 'ลงทะเบียน'
  ];
  return activityKeywords.some(keyword => text.includes(keyword)) ? 'activity' : 'other';
}

function extractImages(post) {
  const images = [];
  if (post.attachments && Array.isArray(post.attachments.data)) {
    for (const attachment of post.attachments.data) {
      collectAttachmentImages(attachment, images);
    }
  }

  if (images.length === 0 && post.full_picture) {
    images.push(post.full_picture);
  }

  return images;
}

function collectAttachmentImages(attachment, images) {
  if (attachment.subattachments && Array.isArray(attachment.subattachments.data)) {
    for (const item of attachment.subattachments.data) {
      collectAttachmentImages(item, images);
    }
  } else if (attachment.media && attachment.media.image && attachment.media.image.src) {
    images.push(attachment.media.image.src);
  } else if (attachment.url) {
    images.push(attachment.url);
  }
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  if (!ACCESS_TOKEN) {
    console.log('Warning: FB_ACCESS_TOKEN not set. The app will return sample data only.');
  }
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.log('Warning: Email notifications are not configured. Set EMAIL_USER and EMAIL_PASS.');
  }
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    console.log('Warning: SMS notifications are not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM.');
  }
});
