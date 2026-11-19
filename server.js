const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const app = express();
const db = new Database(path.join(__dirname, 'trades.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS trades(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, quantity REAL DEFAULT 0, entry REAL DEFAULT 0, exit REAL DEFAULT 0, pnl REAL DEFAULT 0, opened TEXT, closed TEXT, session TEXT, setup TEXT, pre_analysis TEXT, post_review TEXT, emotions TEXT, lessons TEXT, tags TEXT, screenshots TEXT, checklist TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS rules(user_id INTEGER PRIMARY KEY, risk REAL DEFAULT 2, max_trades INTEGER DEFAULT 1, daily_loss REAL DEFAULT 2, losing_streak INTEGER DEFAULT 3, rr TEXT DEFAULT '1:2.5', sessions TEXT DEFAULT 'London,Asian', pairs TEXT DEFAULT 'XAUUSD,EURUSD,GBPUSD');`);
app.use(express.json({limit:'15mb'})); app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||'change-this-session-secret',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax'}}));
app.use(express.static(path.join(__dirname,'public')));
const auth=(req,res,next)=>req.session.uid?next():res.status(401).json({error:'Please sign in first'});
// LOCAL AI ANALYSIS - OLLAMA
app.post('/api/ai/report', auth, async (req, res) => {
  try {
    const trades = db.prepare(`
      SELECT symbol, side, quantity, entry, exit, pnl,
             opened, closed, session, setup,
             pre_analysis, post_review, emotions, lessons, tags
      FROM trades
      WHERE user_id = ?
      ORDER BY COALESCE(closed, opened, created_at) DESC
      LIMIT 100
    `).all(req.session.uid);

    if (!trades.length) {
      return res.status(400).json({
        error: 'Please add journal entries first.'
      });
    }

    const safeTrades = trades.map(t => ({
      symbol: String(t.symbol || '').slice(0, 20),
      side: String(t.side || '').slice(0, 12),
      pnl: Number(t.pnl) || 0,
      session: String(t.session || '').slice(0, 40),
      setup: String(t.setup || '').slice(0, 100),
      pre_analysis: String(t.pre_analysis || '').slice(0, 300),
      post_review: String(t.post_review || '').slice(0, 300),
      emotions: String(t.emotions || '').slice(0, 100),
      lessons: String(t.lessons || '').slice(0, 200),
      tags: String(t.tags || '').slice(0, 100)
    }));

    const aiResponse = await fetch(
      'http://127.0.0.1:11434/api/generate',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'qwen2.5:3b',
          stream: false,
          prompt: `
You are an educational trading journal analyst.

Analyze the following historical journal entries.

Provide:
1. Overall journal summary
2. Recorded performance patterns
3. Session and setup observations
4. Emotional discipline observations
5. Repeated mistakes
6. Areas for improvement
7. Questions for self-reflection

Never invent missing data.
Mention when the sample size is small.
Do not give buy/sell signals, price predictions,
price targets, leverage guidance or trade execution instructions.

This is educational journal analysis only.

Journal data:
${JSON.stringify(safeTrades)}
          `
        })
      }
    );

    if (!aiResponse.ok) {
      throw new Error('Ollama request failed');
    }

    const result = await aiResponse.json();

    if (!result.response) {
      throw new Error('AI returned an empty report');
    }

    res.json({
      ok: true,
      report: result.response
    });

  } catch (error) {
    console.error('Local AI Error:', error.message);

    res.status(502).json({
      error: 'Local AI is unavailable. Check that Ollama is running.'
    });
  }
});
app.post('/api/register',async(req,res)=>{try{const {name,email,password}=req.body;if(!name||!email||!password||password.length<8)return res.status(400).json({error:'Enter name, email and a password with at least 8 characters'});const hash=await bcrypt.hash(password,10);const q=db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)').run(name,email.toLowerCase(),hash);req.session.uid=q.lastInsertRowid;req.session.name=name;res.json({ok:true,name});}catch(e){res.status(400).json({error:'Email may already be registered'});}});
app.post('/api/login',async(req,res)=>{const u=db.prepare('SELECT * FROM users WHERE email=?').get((req.body.email||'').toLowerCase());if(!u||!await bcrypt.compare(req.body.password||'',u.password))return res.status(401).json({error:'Incorrect email or password'});req.session.uid=u.id;req.session.name=u.name;res.json({ok:true,name:u.name});});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',(req,res)=>res.json({signedIn:!!req.session.uid,name:req.session.name||''}));
app.get('/api/trades',auth,(req,res)=>res.json(db.prepare('SELECT * FROM trades WHERE user_id=? ORDER BY COALESCE(opened,created_at) DESC').all(req.session.uid)));
app.post('/api/trades',auth,(req,res)=>{const t=req.body;const info=db.prepare(`INSERT INTO trades(user_id,symbol,side,quantity,entry,exit,pnl,opened,closed,session,setup,pre_analysis,post_review,emotions,lessons,tags,screenshots,checklist) VALUES(@uid,@symbol,@side,@quantity,@entry,@exit,@pnl,@opened,@closed,@session,@setup,@pre_analysis,@post_review,@emotions,@lessons,@tags,@screenshots,@checklist)`).run({uid:req.session.uid,symbol:t.symbol||'XAUUSD',side:t.side||'Long',quantity:+t.quantity||0,entry:+t.entry||0,exit:+t.exit||0,pnl:+t.pnl||0,opened:t.opened||'',closed:t.closed||'',session:t.session||'',setup:t.setup||'',pre_analysis:t.pre_analysis||'',post_review:t.post_review||'',emotions:t.emotions||'',lessons:t.lessons||'',tags:t.tags||'',screenshots:JSON.stringify(t.screenshots||[]),checklist:JSON.stringify(t.checklist||[])});res.json({ok:true,id:info.lastInsertRowid});});
app.put('/api/trades/:id',auth,(req,res)=>{const t=req.body;const r=db.prepare(`UPDATE trades SET symbol=@symbol,side=@side,quantity=@quantity,entry=@entry,exit=@exit,pnl=@pnl,opened=@opened,closed=@closed,session=@session,setup=@setup,pre_analysis=@pre_analysis,post_review=@post_review,emotions=@emotions,lessons=@lessons,tags=@tags,screenshots=@screenshots,checklist=@checklist WHERE id=@id AND user_id=@uid`).run({id:req.params.id,uid:req.session.uid,symbol:t.symbol,side:t.side,quantity:+t.quantity||0,entry:+t.entry||0,exit:+t.exit||0,pnl:+t.pnl||0,opened:t.opened||'',closed:t.closed||'',session:t.session||'',setup:t.setup||'',pre_analysis:t.pre_analysis||'',post_review:t.post_review||'',emotions:t.emotions||'',lessons:t.lessons||'',tags:t.tags||'',screenshots:JSON.stringify(t.screenshots||[]),checklist:JSON.stringify(t.checklist||[])});res.json({ok:!!r.changes});});
app.delete('/api/trades/:id',auth,(req,res)=>res.json({ok:!!db.prepare('DELETE FROM trades WHERE id=? AND user_id=?').run(req.params.id,req.session.uid).changes}));
app.delete('/api/trades',auth,(req,res)=>{db.prepare('DELETE FROM trades WHERE user_id=?').run(req.session.uid);res.json({ok:true});});
app.get('/api/rules',auth,(req,res)=>{let r=db.prepare('SELECT * FROM rules WHERE user_id=?').get(req.session.uid);if(!r){db.prepare('INSERT INTO rules(user_id) VALUES(?)').run(req.session.uid);r=db.prepare('SELECT * FROM rules WHERE user_id=?').get(req.session.uid);}res.json(r);});
app.put('/api/rules',auth,(req,res)=>{const r=req.body;db.prepare(`INSERT INTO rules(user_id,risk,max_trades,daily_loss,losing_streak,rr,sessions,pairs) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET risk=excluded.risk,max_trades=excluded.max_trades,daily_loss=excluded.daily_loss,losing_streak=excluded.losing_streak,rr=excluded.rr,sessions=excluded.sessions,pairs=excluded.pairs`).run(req.session.uid,+r.risk||2,+r.max_trades||1,+r.daily_loss||2,+r.losing_streak||3,r.rr||'1:2.5',r.sessions||'London,Asian',r.pairs||'XAUUSD');res.json({ok:true});});
app.listen(process.env.PORT||3000,()=>console.log(`TradeFXBook workspace running at http://localhost:${process.env.PORT||3000}`));
