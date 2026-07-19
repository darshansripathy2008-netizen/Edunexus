require('dotenv').config();
const express = require('express');
const session = require('express-session');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const serviceAccount = require('./serviceAccount.json');

// Firebase init
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// =====================
// AUTH MIDDLEWARE
// =====================
function requireAuth(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Not logged in.' });
    if (role && req.session.user.role !== role && req.session.user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Access denied.' });
    next();
  };
}

// =====================
// AUTH ROUTES
// =====================

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const e = email.toLowerCase().trim();
    const snap = await db.collection('users').where('email', '==', e).get();
    if (snap.empty) return res.json({ success: false, message: 'User not found.' });
    const user = snap.docs[0].data();
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: 'Wrong password.' });
    req.session.user = {
      id: snap.docs[0].id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar || ''
    };
    res.json({ success: true, role: user.role, name: user.name });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Server error.' });
  }
});

// Logout
app.post('/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user
app.get('/auth/me', (req, res) => {
  if (!req.session.user) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, user: req.session.user });
});

// =====================
// SEED DEMO DATA
// =====================
app.post('/admin/seed', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASS)
      return res.json({ success: false, message: 'Wrong password.' });

    const hash = async (p) => await bcrypt.hash(p, 10);

    // Demo users
    const users = [
      { name: 'Admin', email: 'admin@edunexus.com', password: await hash('admin123'), role: 'admin' },
      { name: 'Mrs. Priya Sharma', email: 'priya@edunexus.com', password: await hash('teacher123'), role: 'teacher', subject: 'Mathematics', class: '10A' },
      { name: 'Mr. Arjun Kumar', email: 'arjun@edunexus.com', password: await hash('parent123'), role: 'parent', childId: 'student1' },
      { name: 'Rahul Kumar', email: 'rahul@edunexus.com', password: await hash('student123'), role: 'student', class: '10A', parentId: 'parent1', rollNo: '101', points: 450 }
    ];

    const batch = db.batch();
    const ids = ['admin1', 'teacher1', 'parent1', 'student1'];
    users.forEach((u, i) => {
      batch.set(db.collection('users').doc(ids[i]), u);
    });

    // Demo students
    const students = [
      { name: 'Rahul Kumar', class: '10A', rollNo: '101', parentId: 'parent1', points: 450, badges: ['🌟 Star Student', '📚 Bookworm'] },
      { name: 'Priya Patel', class: '10A', rollNo: '102', parentId: 'parent2', points: 380, badges: ['🎯 On Target'] },
      { name: 'Arjun Singh', class: '10A', rollNo: '103', parentId: 'parent3', points: 520, badges: ['🏆 Champion', '⚡ Quick Learner'] },
      { name: 'Sneha Rao', class: '10A', rollNo: '104', parentId: 'parent4', points: 290, badges: ['💡 Creative'] },
      { name: 'Karthik M', class: '10A', rollNo: '105', parentId: 'parent5', points: 410, badges: ['🌟 Star Student'] }
    ];
    students.forEach((s, i) => {
      batch.set(db.collection('students').doc('student' + (i+1)), s);
    });

    // Demo grades
    const subjects = ['Mathematics', 'Science', 'English', 'History', 'Computer Science'];
    const gradeData = [
      [85, 90, 78, 88, 95],
      [72, 68, 80, 75, 82],
      [91, 88, 85, 90, 97],
      [65, 70, 72, 68, 75],
      [88, 85, 90, 82, 92]
    ];
    students.forEach((s, si) => {
      subjects.forEach((sub, subI) => {
        batch.set(db.collection('grades').doc(`student${si+1}_${sub}`), {
          studentId: 'student' + (si+1),
          subject: sub,
          marks: gradeData[si][subI],
          total: 100,
          grade: gradeData[si][subI] >= 90 ? 'A+' : gradeData[si][subI] >= 80 ? 'A' : gradeData[si][subI] >= 70 ? 'B' : 'C',
          date: new Date().toISOString()
        });
      });
    });

    // Demo attendance (last 7 days)
    students.forEach((s, si) => {
      for (let d = 0; d < 7; d++) {
        const date = new Date();
        date.setDate(date.getDate() - d);
        const dateStr = date.toISOString().split('T')[0];
        batch.set(db.collection('attendance').doc(`student${si+1}_${dateStr}`), {
          studentId: 'student' + (si+1),
          date: dateStr,
          status: Math.random() > 0.15 ? 'present' : 'absent'
        });
      }
    });

    // Demo announcements
    const announcements = [
      { title: '📝 Unit Test Next Week', message: 'Unit test for all subjects scheduled from Monday. Students must carry their ID cards.', by: 'teacher1', byName: 'Mrs. Priya Sharma', date: new Date().toISOString(), important: true },
      { title: '🏖️ School Picnic', message: 'Annual school picnic on 25th June. Permission slips to be submitted by Friday.', by: 'teacher1', byName: 'Mrs. Priya Sharma', date: new Date().toISOString(), important: false },
      { title: '📚 Library Books Due', message: 'All library books must be returned before end of term.', by: 'teacher1', byName: 'Mrs. Priya Sharma', date: new Date().toISOString(), important: false }
    ];
    announcements.forEach((a, i) => {
      batch.set(db.collection('announcements').doc('ann' + (i+1)), a);
    });

    // Demo homework
    const homeworks = [
      { title: 'Math Chapter 5 Exercise', subject: 'Mathematics', dueDate: new Date(Date.now() + 86400000).toISOString(), points: 50, submittedBy: ['student1', 'student3'], by: 'teacher1' },
      { title: 'Science Lab Report', subject: 'Science', dueDate: new Date(Date.now() + 2*86400000).toISOString(), points: 75, submittedBy: ['student1', 'student2', 'student3'], by: 'teacher1' },
      { title: 'English Essay', subject: 'English', dueDate: new Date(Date.now() + 3*86400000).toISOString(), points: 60, submittedBy: ['student2'], by: 'teacher1' }
    ];
    homeworks.forEach((h, i) => {
      batch.set(db.collection('homework').doc('hw' + (i+1)), h);
    });

    // Demo wellness check-ins
    const moods = [4, 3, 5, 2, 4, 3, 5];
    const messages = [
      'Feeling good today!',
      'A bit stressed about exams',
      'Had a great day!',
      'Feeling overwhelmed with homework',
      'Pretty normal day',
      'Tired but okay',
      'Excited about the picnic!'
    ];
    moods.forEach((mood, i) => {
      const date = new Date();
      date.setDate(date.getDate() - i);
      batch.set(db.collection('wellness').doc('w' + (i+1)), {
        studentId: 'student1',
        mood,
        message: messages[i],
        sentiment: mood >= 4 ? 'positive' : mood === 3 ? 'neutral' : 'negative',
        date: date.toISOString(),
        anonymous: true
      });
    });

    // Demo chat
    batch.set(db.collection('chats').doc('chat_teacher1_parent1'), {
      teacherId: 'teacher1',
      parentId: 'parent1',
      studentId: 'student1',
      messages: [
        { from: 'teacher1', fromName: 'Mrs. Priya', text: 'Hello! Rahul has been doing great in class recently.', time: new Date(Date.now() - 3600000).toISOString() },
        { from: 'parent1', fromName: 'Mr. Arjun', text: 'Thank you! He has been studying hard at home too.', time: new Date(Date.now() - 1800000).toISOString() },
        { from: 'teacher1', fromName: 'Mrs. Priya', text: 'Please make sure he submits the Math homework by tomorrow.', time: new Date(Date.now() - 900000).toISOString() }
      ]
    });

    await batch.commit();
    res.json({ success: true, message: 'Demo data seeded successfully!' });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: err.message });
  }
});

// =====================
// DASHBOARD ROUTES
// =====================

// Teacher dashboard data
app.get('/api/teacher/dashboard', requireAuth('teacher'), async (req, res) => {
  try {
    const [studentsSnap, announcementsSnap, homeworkSnap, wellnessSnap] = await Promise.all([
      db.collection('students').where('class', '==', '10A').get(),
      db.collection('announcements').orderBy('date', 'desc').limit(5).get(),
      db.collection('homework').where('by', '==', req.session.user.id).get(),
      db.collection('wellness').orderBy('date', 'desc').limit(10).get()
    ]);

    const students = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const announcements = announcementsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const homework = homeworkSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const wellness = wellnessSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const avgMood = wellness.length ? (wellness.reduce((s, w) => s + w.mood, 0) / wellness.length).toFixed(1) : 0;
    const negativeMoods = wellness.filter(w => w.mood <= 2).length;

    res.json({ success: true, students, announcements, homework, avgMood, negativeMoods });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Parent dashboard data
app.get('/api/parent/dashboard', requireAuth('parent'), async (req, res) => {
  try {
    const userSnap = await db.collection('users').doc(req.session.user.id).get();
    const childId = userSnap.data().childId;
    const [studentSnap, gradesSnap, attendanceSnap, announcementsSnap, wellnessSnap] = await Promise.all([
      db.collection('students').doc(childId).get(),
      db.collection('grades').where('studentId', '==', childId).get(),
      db.collection('attendance').where('studentId', '==', childId).orderBy('date', 'desc').limit(14).get(),
      db.collection('announcements').orderBy('date', 'desc').limit(5).get(),
      db.collection('wellness').where('studentId', '==', childId).orderBy('date', 'desc').limit(7).get()
    ]);

    const student = { id: studentSnap.id, ...studentSnap.data() };
    const grades = gradesSnap.docs.map(d => d.data());
    const attendance = attendanceSnap.docs.map(d => d.data());
    const announcements = announcementsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const wellness = wellnessSnap.docs.map(d => d.data());
    const presentDays = attendance.filter(a => a.status === 'present').length;
    const attendancePct = attendance.length ? Math.round(presentDays / attendance.length * 100) : 0;
    const avgGrade = grades.length ? Math.round(grades.reduce((s, g) => s + g.marks, 0) / grades.length) : 0;

    res.json({ success: true, student, grades, attendance, announcements, wellness, attendancePct, avgGrade });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Student dashboard data
app.get('/api/student/dashboard', requireAuth('student'), async (req, res) => {
  try {
    const [studentSnap, gradesSnap, attendanceSnap, homeworkSnap, announcementsSnap] = await Promise.all([
      db.collection('students').doc(req.session.user.id).get(),
      db.collection('grades').where('studentId', '==', req.session.user.id).get(),
      db.collection('attendance').where('studentId', '==', req.session.user.id).orderBy('date', 'desc').limit(7).get(),
      db.collection('homework').get(),
      db.collection('announcements').orderBy('date', 'desc').limit(5).get()
    ]);

    const student = studentSnap.exists ? { id: studentSnap.id, ...studentSnap.data() } : {};
    const grades = gradesSnap.docs.map(d => d.data());
    const attendance = attendanceSnap.docs.map(d => d.data());
    const homework = homeworkSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const announcements = announcementsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    res.json({ success: true, student, grades, attendance, homework, announcements });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Post announcement
app.post('/api/announcements', requireAuth('teacher'), async (req, res) => {
  try {
    const { title, message, important } = req.body;
    await db.collection('announcements').add({
      title, message, important: important || false,
      by: req.session.user.id,
      byName: req.session.user.name,
      date: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Post wellness check-in
app.post('/api/wellness', requireAuth('student'), async (req, res) => {
  try {
    const { mood, message } = req.body;
    const sentiment = mood >= 4 ? 'positive' : mood === 3 ? 'neutral' : 'negative';
    await db.collection('wellness').add({
      studentId: req.session.user.id,
      mood: parseInt(mood),
      message: message || '',
      sentiment,
      date: new Date().toISOString(),
      anonymous: true
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Submit homework
app.post('/api/homework/submit', requireAuth('student'), async (req, res) => {
  try {
    const { homeworkId } = req.body;
    const hwRef = db.collection('homework').doc(homeworkId);
    const hw = await hwRef.get();
    if (!hw.exists) return res.json({ success: false, message: 'Homework not found.' });
    const submittedBy = hw.data().submittedBy || [];
    if (submittedBy.includes(req.session.user.id))
      return res.json({ success: false, message: 'Already submitted.' });
    submittedBy.push(req.session.user.id);
    await hwRef.update({ submittedBy });
    const studentRef = db.collection('students').doc(req.session.user.id);
    const student = await studentRef.get();
    if (student.exists) {
      await studentRef.update({ points: (student.data().points || 0) + hw.data().points });
    }
    res.json({ success: true, pointsEarned: hw.data().points });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Get chat
app.get('/api/chat/:otherId', requireAuth(), async (req, res) => {
  try {
    const user = req.session.user;
    const chatId = user.role === 'teacher'
      ? `chat_${user.id}_${req.params.otherId}`
      : `chat_${req.params.otherId}_${user.id}`;
    const chatSnap = await db.collection('chats').doc(chatId).get();
    const messages = chatSnap.exists ? chatSnap.data().messages || [] : [];
    res.json({ success: true, messages, chatId });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Send chat message
app.post('/api/chat/send', requireAuth(), async (req, res) => {
  try {
    const { chatId, text } = req.body;
    const user = req.session.user;
    const chatRef = db.collection('chats').doc(chatId);
    const chatSnap = await chatRef.get();
    const messages = chatSnap.exists ? chatSnap.data().messages || [] : [];
    messages.push({
      from: user.id,
      fromName: user.name,
      text,
      time: new Date().toISOString()
    });
    await chatRef.set({ messages }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Mark attendance
app.post('/api/attendance', requireAuth('teacher'), async (req, res) => {
  try {
    const { attendance } = req.body;
    const batch = db.batch();
    const today = new Date().toISOString().split('T')[0];
    attendance.forEach(({ studentId, status }) => {
      batch.set(db.collection('attendance').doc(`${studentId}_${today}`), {
        studentId, status, date: today
      });
    });
    await batch.commit();
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Gate pass request
app.post('/api/gatepass', requireAuth('student'), async (req, res) => {
  try {
    const { reason, exitTime } = req.body;
    await db.collection('gatepasses').add({
      studentId: req.session.user.id,
      studentName: req.session.user.name,
      reason, exitTime,
      status: 'pending',
      date: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Get gate passes (teacher)
app.get('/api/gatepasses', requireAuth('teacher'), async (req, res) => {
  try {
    const snap = await db.collection('gatepasses').orderBy('date', 'desc').get();
    const passes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, passes });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Approve/reject gate pass
app.post('/api/gatepass/update', requireAuth('teacher'), async (req, res) => {
  try {
    const { passId, status } = req.body;
    await db.collection('gatepasses').doc(passId).update({
      status,
      approvedBy: req.session.user.name,
      updatedAt: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ EduNexus running on port ${PORT}`));