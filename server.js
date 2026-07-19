require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

// Supabase init (service role for server-side)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
    if (!req.session.user)
      return res.status(401).json({ success: false, message: 'Not logged in.' });
    if (role && req.session.user.role !== role && req.session.user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Access denied.' });
    next();
  };
}

// =====================
// AUTH ROUTES
// =====================

// Register (used for seeding)
app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, extra } = req.body;

    // Create auth user in Supabase
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (authError) return res.json({ success: false, message: authError.message });

    // Create profile
    const { error: profileError } = await supabase.from('profiles').insert({
      id: authData.user.id,
      name, role, ...extra
    });
    if (profileError) return res.json({ success: false, message: profileError.message });

    res.json({ success: true, id: authData.user.id });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.json({ success: false, message: 'Invalid email or password.' });

    // Get profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();
    if (profileError || !profile)
      return res.json({ success: false, message: 'Profile not found.' });

    req.session.user = {
      id: data.user.id,
      name: profile.name,
      email: data.user.email,
      role: profile.role,
      class: profile.class || '',
      childId: profile.child_id || '',
      supabaseToken: data.session.access_token
    };

    res.json({ success: true, role: profile.role, name: profile.name });
  } catch (err) {
    res.json({ success: false, message: err.message });
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
    if (password !== 'admin123')
      return res.json({ success: false, message: 'Wrong password.' });

    // Create users
    const usersToCreate = [
      { name: 'Admin User', email: 'admin@edunexus.com', password: 'admin123', role: 'admin', extra: {} },
      { name: 'Mrs. Priya Sharma', email: 'priya@edunexus.com', password: 'teacher123', role: 'teacher', extra: { subject: 'Mathematics', class: '10A' } },
      { name: 'Mr. Arjun Kumar', email: 'arjun@edunexus.com', password: 'parent123', role: 'parent', extra: {} },
      { name: 'Rahul Kumar', email: 'rahul@edunexus.com', password: 'student123', role: 'student', extra: { class: '10A', roll_no: '101', points: 450 } }
    ];

    const userIds = {};
    for (const u of usersToCreate) {
      // Delete existing user if any
      const { data: existing } = await supabase.auth.admin.listUsers();
      const found = existing?.users?.find(eu => eu.email === u.email);
      if (found) await supabase.auth.admin.deleteUser(found.id);

      const { data: authData, error } = await supabase.auth.admin.createUser({
        email: u.email, password: u.password, email_confirm: true
      });
      if (error) { console.error(u.email, error); continue; }

      await supabase.from('profiles').upsert({
        id: authData.user.id, name: u.name, role: u.role, ...u.extra
      });
      userIds[u.role] = authData.user.id;
    }

    // Create students
    const { data: studentsData } = await supabase.from('students').upsert([
      { name: 'Rahul Kumar', class: '10A', roll_no: '101', points: 450, badges: ['🌟 Star Student', '📚 Bookworm'] },
      { name: 'Priya Patel', class: '10A', roll_no: '102', points: 380, badges: ['🎯 On Target'] },
      { name: 'Arjun Singh', class: '10A', roll_no: '103', points: 520, badges: ['🏆 Champion', '⚡ Quick Learner'] },
      { name: 'Sneha Rao', class: '10A', roll_no: '104', points: 290, badges: ['💡 Creative'] },
      { name: 'Karthik M', class: '10A', roll_no: '105', points: 410, badges: ['🌟 Star Student'] }
    ]).select();

    // Update parent's child_id
    if (studentsData && studentsData[0]) {
      await supabase.from('profiles').update({ child_id: studentsData[0].id })
        .eq('id', userIds['parent']);
      await supabase.from('profiles').update({ child_id: studentsData[0].id })
        .eq('email', 'rahul@edunexus.com');
    }

    // Create grades
    const subjects = ['Mathematics', 'Science', 'English', 'History', 'Computer Science'];
    const gradeData = [
      [85, 90, 78, 88, 95],
      [72, 68, 80, 75, 82],
      [91, 88, 85, 90, 97],
      [65, 70, 72, 68, 75],
      [88, 85, 90, 82, 92]
    ];
    if (studentsData) {
      const gradesInsert = [];
      studentsData.forEach((s, si) => {
        subjects.forEach((sub, subI) => {
          const marks = gradeData[si][subI];
          gradesInsert.push({
            student_id: s.id, subject: sub, marks,
            total: 100,
            grade: marks >= 90 ? 'A+' : marks >= 80 ? 'A' : marks >= 70 ? 'B' : 'C'
          });
        });
      });
      await supabase.from('grades').upsert(gradesInsert);
    }

    // Create attendance (last 7 days)
    if (studentsData) {
      const attendanceInsert = [];
      studentsData.forEach(s => {
        for (let d = 0; d < 7; d++) {
          const date = new Date();
          date.setDate(date.getDate() - d);
          attendanceInsert.push({
            student_id: s.id,
            date: date.toISOString().split('T')[0],
            status: Math.random() > 0.15 ? 'present' : 'absent'
          });
        }
      });
      await supabase.from('attendance').upsert(attendanceInsert, { onConflict: 'student_id,date' });
    }

    // Create announcements
    await supabase.from('announcements').upsert([
      { title: '📝 Unit Test Next Week', message: 'Unit test scheduled from Monday. Students must carry ID cards.', by_name: 'Mrs. Priya Sharma', important: true },
      { title: '🏖️ School Picnic', message: 'Annual school picnic on 25th June. Permission slips due Friday.', by_name: 'Mrs. Priya Sharma', important: false },
      { title: '📚 Library Books Due', message: 'All library books must be returned before end of term.', by_name: 'Mrs. Priya Sharma', important: false }
    ]);

    // Create homework
    if (studentsData) {
      const { data: hwData } = await supabase.from('homework').upsert([
        { title: 'Math Chapter 5 Exercise', subject: 'Mathematics', description: 'Complete exercises 5.1 to 5.4', due_date: new Date(Date.now() + 86400000).toISOString(), points: 50 },
        { title: 'Science Lab Report', subject: 'Science', description: 'Write lab report on photosynthesis experiment', due_date: new Date(Date.now() + 2*86400000).toISOString(), points: 75 },
        { title: 'English Essay', subject: 'English', description: 'Write 500 word essay on climate change', due_date: new Date(Date.now() + 3*86400000).toISOString(), points: 60 }
      ]).select();

      // Add some submissions
      if (hwData && studentsData[0]) {
        await supabase.from('homework_submissions').upsert([
          { homework_id: hwData[0].id, student_id: studentsData[0].id },
          { homework_id: hwData[1].id, student_id: studentsData[0].id },
          { homework_id: hwData[1].id, student_id: studentsData[1].id }
        ], { onConflict: 'homework_id,student_id' });
      }
    }

    // Create wellness check-ins
    if (studentsData) {
      const moods = [4, 3, 5, 2, 4, 3, 5];
      const messages = [
        'Feeling good today!', 'A bit stressed about exams', 'Had a great day!',
        'Feeling overwhelmed', 'Pretty normal day', 'Tired but okay', 'Excited about picnic!'
      ];
      const wellnessInsert = moods.map((mood, i) => {
        const date = new Date();
        date.setDate(date.getDate() - i);
        return {
          student_id: studentsData[0].id, mood, message: messages[i],
          sentiment: mood >= 4 ? 'positive' : mood === 3 ? 'neutral' : 'negative',
          created_at: date.toISOString()
        };
      });
      await supabase.from('wellness').upsert(wellnessInsert);
    }

    // Create chat
    if (userIds['teacher'] && userIds['parent'] && studentsData) {
      const { data: chatData } = await supabase.from('chats').upsert({
        teacher_id: userIds['teacher'],
        parent_id: userIds['parent'],
        student_id: studentsData[0].id
      }, { onConflict: 'teacher_id,parent_id' }).select().single();

      if (chatData) {
        await supabase.from('messages').upsert([
          { chat_id: chatData.id, from_id: userIds['teacher'], from_name: 'Mrs. Priya', text: 'Hello! Rahul has been doing great in class recently.', created_at: new Date(Date.now() - 3600000).toISOString() },
          { chat_id: chatData.id, from_id: userIds['parent'], from_name: 'Mr. Arjun', text: 'Thank you! He has been studying hard at home too.', created_at: new Date(Date.now() - 1800000).toISOString() },
          { chat_id: chatData.id, from_id: userIds['teacher'], from_name: 'Mrs. Priya', text: 'Please make sure he submits the Math homework by tomorrow.', created_at: new Date(Date.now() - 900000).toISOString() }
        ]);
      }
    }

    res.json({ success: true, message: '✅ Demo data seeded successfully!' });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: err.message });
  }
});

// =====================
// TEACHER ROUTES
// =====================
app.get('/api/teacher/dashboard', requireAuth('teacher'), async (req, res) => {
  try {
    const [students, announcements, homework, wellness] = await Promise.all([
      supabase.from('students').select('*').eq('class', '10A'),
      supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('homework').select('*, homework_submissions(count)').order('created_at', { ascending: false }),
      supabase.from('wellness').select('*').order('created_at', { ascending: false }).limit(20)
    ]);

    const wellnessData = wellness.data || [];
    const avgMood = wellnessData.length
      ? (wellnessData.reduce((s, w) => s + w.mood, 0) / wellnessData.length).toFixed(1) : 0;
    const negativeMoods = wellnessData.filter(w => w.mood <= 2).length;

    res.json({
      success: true,
      students: students.data || [],
      announcements: announcements.data || [],
      homework: homework.data || [],
      avgMood, negativeMoods
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.get('/api/teacher/students', requireAuth('teacher'), async (req, res) => {
  try {
    const { data: students } = await supabase.from('students').select(`
      *, grades(*), attendance(*)
    `).eq('class', '10A');
    res.json({ success: true, students: students || [] });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/attendance', requireAuth('teacher'), async (req, res) => {
  try {
    const { attendance } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const rows = attendance.map(({ studentId, status }) => ({
      student_id: studentId, date: today, status
    }));
    const { error } = await supabase.from('attendance')
      .upsert(rows, { onConflict: 'student_id,date' });
    if (error) return res.json({ success: false, message: error.message });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/announcements', requireAuth('teacher'), async (req, res) => {
  try {
    const { title, message, important } = req.body;
    const { error } = await supabase.from('announcements').insert({
      title, message, important: important || false,
      by_id: req.session.user.id, by_name: req.session.user.name
    });
    if (error) return res.json({ success: false, message: error.message });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/homework', requireAuth('teacher'), async (req, res) => {
  try {
    const { title, subject, description, dueDate, points } = req.body;
    const { error } = await supabase.from('homework').insert({
      title, subject, description, due_date: dueDate,
      points: points || 50, by_id: req.session.user.id
    });
    if (error) return res.json({ success: false, message: error.message });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.get('/api/gatepasses', requireAuth('teacher'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('gatepasses')
      .select('*').order('created_at', { ascending: false });
    if (error) return res.json({ success: false, message: error.message });
    res.json({ success: true, passes: data });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/gatepass/update', requireAuth('teacher'), async (req, res) => {
  try {
    const { passId, status } = req.body;
    const { error } = await supabase.from('gatepasses').update({
      status, approved_by: req.session.user.name
    }).eq('id', passId);
    if (error) return res.json({ success: false, message: error.message });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// =====================
// PARENT ROUTES
// =====================
app.get('/api/parent/dashboard', requireAuth('parent'), async (req, res) => {
  try {
    const { data: profile } = await supabase.from('profiles')
      .select('*').eq('id', req.session.user.id).single();

    const childId = profile?.child_id;
    if (!childId) return res.json({ success: false, message: 'No child linked.' });

    const [student, grades, attendance, announcements, wellness] = await Promise.all([
      supabase.from('students').select('*').eq('id', childId).single(),
      supabase.from('grades').select('*').eq('student_id', childId),
      supabase.from('attendance').select('*').eq('student_id', childId).order('date', { ascending: false }).limit(14),
      supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('wellness').select('*').eq('student_id', childId).order('created_at', { ascending: false }).limit(7)
    ]);

    const att = attendance.data || [];
    const presentDays = att.filter(a => a.status === 'present').length;
    const attendancePct = att.length ? Math.round(presentDays / att.length * 100) : 0;
    const gr = grades.data || [];
    const avgGrade = gr.length ? Math.round(gr.reduce((s, g) => s + g.marks, 0) / gr.length) : 0;

    res.json({
      success: true,
      student: student.data,
      grades: gr,
      attendance: att,
      announcements: announcements.data || [],
      wellness: wellness.data || [],
      attendancePct, avgGrade
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// =====================
// STUDENT ROUTES
// =====================
app.get('/api/student/dashboard', requireAuth('student'), async (req, res) => {
  try {
    const { data: profile } = await supabase.from('profiles')
      .select('*').eq('id', req.session.user.id).single();

    const childId = profile?.child_id || req.session.user.id;

    const [grades, attendance, homework, announcements, submissions] = await Promise.all([
      supabase.from('grades').select('*').eq('student_id', childId),
      supabase.from('attendance').select('*').eq('student_id', childId).order('date', { ascending: false }).limit(7),
      supabase.from('homework').select('*').order('due_date', { ascending: true }),
      supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('homework_submissions').select('homework_id').eq('student_id', childId)
    ]);

    res.json({
      success: true,
      profile,
      grades: grades.data || [],
      attendance: attendance.data || [],
      homework: homework.data || [],
      announcements: announcements.data || [],
      submittedIds: (submissions.data || []).map(s => s.homework_id)
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/wellness', requireAuth('student'), async (req, res) => {
  try {
    const { mood, message } = req.body;
    const sentiment = mood >= 4 ? 'positive' : mood === 3 ? 'neutral' : 'negative';
    const { data: profile } = await supabase.from('profiles')
      .select('child_id').eq('id', req.session.user.id).single();

    const { error } = await supabase.from('wellness').insert({
      student_id: profile?.child_id || req.session.user.id,
      mood: parseInt(mood), message: message || '',
      sentiment, anonymous: true
    });
    if (error) return res.json({ success: false, message: error.message });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/homework/submit', requireAuth('student'), async (req, res) => {
  try {
    const { homeworkId } = req.body;
    const { data: profile } = await supabase.from('profiles')
      .select('child_id').eq('id', req.session.user.id).single();
    const studentId = profile?.child_id || req.session.user.id;

    const { error } = await supabase.from('homework_submissions')
      .upsert({ homework_id: homeworkId, student_id: studentId },
        { onConflict: 'homework_id,student_id' });
    if (error) return res.json({ success: false, message: error.message });

    const { data: hw } = await supabase.from('homework').select('points').eq('id', homeworkId).single();
    const points = hw?.points || 50;
    await supabase.from('students').update({ points: supabase.rpc('increment', { x: points }) })
      .eq('id', studentId);

    res.json({ success: true, pointsEarned: points });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/gatepass', requireAuth('student'), async (req, res) => {
  try {
    const { reason, exitTime } = req.body;
    const { error } = await supabase.from('gatepasses').insert({
      student_id: req.session.user.id,
      student_name: req.session.user.name,
      reason, exit_time: exitTime, status: 'pending'
    });
    if (error) return res.json({ success: false, message: error.message });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// =====================
// CHAT ROUTES
// =====================
app.get('/api/chat/get', requireAuth(), async (req, res) => {
  try {
    const user = req.session.user;
    let chat;
    if (user.role === 'teacher') {
      const { data } = await supabase.from('chats').select('*, messages(*)').eq('teacher_id', user.id);
      chat = data?.[0];
    } else if (user.role === 'parent') {
      const { data } = await supabase.from('chats').select('*, messages(*)').eq('parent_id', user.id);
      chat = data?.[0];
    }
    if (!chat) return res.json({ success: true, messages: [], chatId: null });
    const messages = (chat.messages || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    res.json({ success: true, messages, chatId: chat.id });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/chat/send', requireAuth(), async (req, res) => {
  try {
    const { chatId, text } = req.body;
    const user = req.session.user;
    let finalChatId = chatId;

    if (!finalChatId) {
      const { data: newChat } = await supabase.from('chats').upsert({
        teacher_id: user.role === 'teacher' ? user.id : null,
        parent_id: user.role === 'parent' ? user.id : null
      }).select().single();
      finalChatId = newChat?.id;
    }

    const { error } = await supabase.from('messages').insert({
      chat_id: finalChatId, from_id: user.id,
      from_name: user.name, text
    });
    if (error) return res.json({ success: false, message: error.message });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ EduNexus running on port ${PORT}`));