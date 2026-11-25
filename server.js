const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const QRCode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "foodtrack-demo-change-this-secret";
const MONGODB_URI = process.env.MONGODB_URI || "";
let mongoReady = false;
const memory = { users: [], orders: [], menu: [
 {id:"m1",name:"Classic Veg Burger",category:"Burgers",price:99,emoji:"🍔",description:"Crispy patty, fresh veggies"},
 {id:"m2",name:"Margherita Pizza",category:"Pizza",price:179,emoji:"🍕",description:"Cheese, basil and tomato"},
 {id:"m3",name:"Masala Dosa",category:"South Indian",price:119,emoji:"🥞",description:"Crispy dosa with chutney"},
 {id:"m4",name:"Paneer Wrap",category:"Wraps",price:139,emoji:"🌯",description:"Spiced paneer and crunchy salad"},
 {id:"m5",name:"French Fries",category:"Sides",price:79,emoji:"🍟",description:"Golden and seasoned"},
 {id:"m6",name:"Chocolate Shake",category:"Drinks",price:89,emoji:"🥤",description:"Creamy chocolate shake"}
]};
const userSchema = new mongoose.Schema({name:String,email:{type:String,unique:true,sparse:true},phone:String,passwordHash:String,role:String,restaurantName:String,location:mongoose.Schema.Types.Mixed,isOnline:{type:Boolean,default:false},createdAt:{type:Date,default:Date.now}});
const orderSchema = new mongoose.Schema({
 orderCode:{type:String,index:true},customerId:String,customerName:String,customerPhone:String,
 restaurantId:String,restaurantName:String,items:Array,total:Number,address:String,
 status:{type:String,default:"pending"},deliveryPartnerId:String,deliveryPartnerName:String,
 restaurantLocation:{lat:Number,lng:Number},customerLocation:{lat:Number,lng:Number},
 deliveryLocation:{lat:Number,lng:Number},distanceKm:Number,qrToken:String,paymentStatus:{type:String,default:"unpaid"},
 createdAt:{type:Date,default:Date.now},updatedAt:{type:Date,default:Date.now}
});
let UserModel, OrderModel;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI).then(()=>{
    mongoReady=true;
    UserModel=mongoose.model("User",userSchema);
    OrderModel=mongoose.model("Order",orderSchema);
    console.log("MongoDB connected");
  }).catch(e=>console.error("MongoDB connection failed; using demo memory mode:",e.message));
}
function publicUser(u){return {id:String(u._id||u.id),name:u.name,email:u.email||"",phone:u.phone||"",role:u.role,restaurantName:u.restaurantName||""};}
function tokenFor(u){return jwt.sign({id:String(u._id||u.id),role:u.role},JWT_SECRET,{expiresIn:"7d"});}
function findUser(id){return mongoReady?UserModel.findById(id):Promise.resolve(memory.users.find(u=>u.id===id));}
function allOrders(){return mongoReady?OrderModel.find().sort({createdAt:-1}).lean():Promise.resolve([...memory.orders].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)));}
function emitOrder(order){const o=order.toObject?order.toObject():order; io.emit("order:update",{id:String(o._id||o.id),customerId:o.customerId,status:o.status,orderCode:o.orderCode}); return o;}
async function saveOrder(data){if(mongoReady){const doc=await OrderModel.create(data);return doc.toObject();}memory.orders.unshift(data);return data;}
async function getOrder(id){if(mongoReady){const o=await OrderModel.findById(id);return o?o.toObject():null;}return memory.orders.find(o=>o.id===id)||null;}
async function updateOrder(id,patch){if(mongoReady){const o=await OrderModel.findByIdAndUpdate(id,{$set:{...patch,updatedAt:new Date()}},{new:true});return o?o.toObject():null;}const o=memory.orders.find(o=>o.id===id);if(!o)return null;Object.assign(o,patch,{updatedAt:new Date().toISOString()});return o;}
function auth(req,res,next){const h=req.headers.authorization||"";const t=h.startsWith("Bearer ")?h.slice(7):"";try{req.auth=jwt.verify(t,JWT_SECRET);next();}catch{return res.status(401).json({error:"Please sign in again."});}}
function roles(...allowed){return (req,res,next)=>allowed.includes(req.auth.role)?next():res.status(403).json({error:"This account role cannot perform that action."});}
function haversine(a,b){if(!a||!b||a.lat==null||a.lng==null||b.lat==null||b.lng==null)return null;const R=6371,dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
function safeOrder(o){return o;}
app.get("/api/health",(req,res)=>res.json({ok:true,service:"Foodtrack API",database:mongoReady?"mongodb":"demo-memory",time:new Date().toISOString()}));
app.get("/api/menu",(req,res)=>res.json(memory.menu));
app.post("/api/auth/signup",async(req,res)=>{
 try{
  const {name,email,phone,password,role,restaurantName}=req.body||{};
  if(!name||!password||!["customer","delivery","restaurant"].includes(role)||(!email&&!phone))return res.status(400).json({error:"Name, password, role and email or phone are required."});
  if(String(password).length<6)return res.status(400).json({error:"Password must be at least 6 characters."});
  const normalizedEmail=email?String(email).trim().toLowerCase():"";
  if(mongoReady){
   const exists=await UserModel.findOne({$or:[...(normalizedEmail?[{email:normalizedEmail}]:[]),...(phone?[{phone:String(phone).trim()}]:[])]});
   if(exists)return res.status(409).json({error:"An account with this email or phone already exists."});
   const doc=await UserModel.create({name,email:normalizedEmail||undefined,phone:phone?String(phone).trim():undefined,passwordHash:await bcrypt.hash(password,10),role,restaurantName:restaurantName||""});
   const u=publicUser(doc);return res.json({user:u,token:tokenFor(doc)});
  }
  if(memory.users.some(u=>(normalizedEmail&&u.email===normalizedEmail)||(phone&&u.phone===String(phone).trim())))return res.status(409).json({error:"An account with this email or phone already exists."});
  const u={id:crypto.randomUUID(),name,email:normalizedEmail,phone:phone?String(phone).trim():"",passwordHash:await bcrypt.hash(password,10),role,restaurantName:restaurantName||""};memory.users.push(u);
  res.json({user:publicUser(u),token:tokenFor(u)});
 }catch(e){res.status(500).json({error:"Could not create account.",detail:e.message});}
});
app.post("/api/auth/login",async(req,res)=>{
 try{
  const {identity,password,role}=req.body||{};if(!identity||!password||!role)return res.status(400).json({error:"Enter email/phone, password and role."});
  let u;
  if(mongoReady)u=await UserModel.findOne({role,$or:[{email:String(identity).trim().toLowerCase()},{phone:String(identity).trim()}]});
  else u=memory.users.find(x=>x.role===role&&(x.email===String(identity).trim().toLowerCase()||x.phone===String(identity).trim()));
  if(!u||!(await bcrypt.compare(password,u.passwordHash)))return res.status(401).json({error:"Incorrect login details for this role."});
  res.json({user:publicUser(u),token:tokenFor(u)});
 }catch(e){res.status(500).json({error:"Login failed."});}
});
app.get("/api/me",auth,async(req,res)=>{const u=await findUser(req.auth.id);if(!u)return res.status(404).json({error:"Account not found."});res.json(publicUser(u));});
app.patch("/api/me/location",auth,roles("delivery"),async(req,res)=>{
 const {lat,lng,isOnline}=req.body||{};
 if(lat!==undefined&&(!Number.isFinite(lat)||!Number.isFinite(lng)))return res.status(400).json({error:"Valid coordinates required."});
 if(mongoReady){const patch={};if(lat!==undefined)patch.location={lat,lng};if(typeof isOnline==="boolean")patch.isOnline=isOnline;const u=await UserModel.findByIdAndUpdate(req.auth.id,{$set:patch},{new:true});return res.json({ok:true,user:publicUser(u)});}
 const u=memory.users.find(x=>x.id===req.auth.id);if(!u)return res.status(404).json({error:"Account not found."});if(lat!==undefined)u.location={lat,lng};if(typeof isOnline==="boolean")u.isOnline=isOnline;res.json({ok:true,user:publicUser(u)});
});
app.get("/api/orders",auth,async(req,res)=>{
 const orders=await allOrders();const visible=orders.filter(o=>req.auth.role==="customer"?o.customerId===req.auth.id:req.auth.role==="restaurant"?(o.restaurantId===req.auth.id||o.restaurantId==="demo-restaurant"):(o.deliveryPartnerId===req.auth.id||["ready","pending"].includes(o.status)));
 res.json(visible);
});
app.post("/api/orders",auth,roles("customer"),async(req,res)=>{
 try{
  const {items,address,customerLocation,restaurantId,restaurantName,restaurantLocation}=req.body||{};
  if(!Array.isArray(items)||!items.length||!address)return res.status(400).json({error:"Add food items and a delivery address."});
  const user=await findUser(req.auth.id);if(!user)return res.status(404).json({error:"Customer not found."});
  const total=items.reduce((sum,i)=>sum+(Number(i.price)||0)*(Number(i.qty)||1),0);
  const order={...(mongoReady?{}:{id:crypto.randomUUID()}),orderCode:"FT"+Date.now().toString().slice(-8),customerId:req.auth.id,customerName:user.name,customerPhone:user.phone||"",restaurantId:restaurantId||"demo-restaurant",restaurantName:restaurantName||"Foodtrack Kitchen",items,total,address,customerLocation:customerLocation||null,restaurantLocation:restaurantLocation||{lat:22.7196,lng:75.8577},status:"pending",deliveryPartnerId:"",deliveryPartnerName:"",deliveryLocation:null,distanceKm:null,qrToken:crypto.randomBytes(16).toString("hex"),paymentStatus:"unpaid",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const saved=await saveOrder(order);emitOrder(saved);res.status(201).json(saved);
 }catch(e){res.status(500).json({error:"Could not place order."});}
});
app.patch("/api/orders/:id/status",auth,async(req,res)=>{
 const {status}=req.body||{};const allowed=["accepted","preparing","ready","picked_up","delivered","rejected"];
 if(!allowed.includes(status))return res.status(400).json({error:"Invalid order status."});
 const o=await getOrder(req.params.id);if(!o)return res.status(404).json({error:"Order not found."});
 const permitted={restaurant:["accepted","preparing","ready","rejected"],delivery:["picked_up","delivered"]};
 if(!(permitted[req.auth.role]||[]).includes(status))return res.status(403).json({error:"Your role cannot set this status."});
 if(req.auth.role==="restaurant"&&o.restaurantId!==req.auth.id&&o.restaurantId!=="demo-restaurant")return res.status(403).json({error:"Not your restaurant order."});
 if(req.auth.role==="delivery"&&o.deliveryPartnerId!==req.auth.id)return res.status(403).json({error:"This order is not assigned to you."});
 if(status==="ready"){
  const allUsers=mongoReady?await UserModel.find({role:"delivery"}).lean():memory.users.filter(u=>u.role==="delivery");
  const candidates=allUsers.filter(u=>u.isOnline!==false).map(u=>({u,dist:haversine(o.restaurantLocation,u.location)})).filter(x=>x.dist!==null&&x.dist<=4).sort((a,b)=>a.dist-b.dist);
  const selected=candidates.find(x=>x.dist<=2)||candidates[0];
  if(selected){o.deliveryPartnerId=String(selected.u._id||selected.u.id);o.deliveryPartnerName=selected.u.name;o.distanceKm=selected.dist;}
 }
 const updated=await updateOrder(req.params.id,{status,...(status==="ready"&&o.deliveryPartnerId?{deliveryPartnerId:o.deliveryPartnerId,deliveryPartnerName:o.deliveryPartnerName,distanceKm:o.distanceKm}:{})});
 emitOrder(updated);res.json(updated);
});
app.post("/api/orders/:id/accept-delivery",auth,roles("delivery"),async(req,res)=>{
 const o=await getOrder(req.params.id);if(!o)return res.status(404).json({error:"Order not found."});
 if(o.status!=="ready")return res.status(409).json({error:"Order is not ready yet."});
 if(o.deliveryPartnerId&&o.deliveryPartnerId!==req.auth.id)return res.status(409).json({error:"Another partner has been assigned."});
 const u=await findUser(req.auth.id);const updated=await updateOrder(o.id||o._id,{deliveryPartnerId:req.auth.id,deliveryPartnerName:u.name});emitOrder(updated);res.json(updated);
});
app.post("/api/orders/:id/location",auth,roles("delivery"),async(req,res)=>{
 const o=await getOrder(req.params.id);if(!o)return res.status(404).json({error:"Order not found."});
 if(o.deliveryPartnerId!==req.auth.id)return res.status(403).json({error:"Not assigned to this order."});
 const {lat,lng}=req.body||{};if(!Number.isFinite(lat)||!Number.isFinite(lng))return res.status(400).json({error:"Valid GPS coordinates required."});
 const updated=await updateOrder(req.params.id,{deliveryLocation:{lat,lng,at:new Date().toISOString()}});io.emit("location:update",{orderId:req.params.id,location:updated.deliveryLocation});res.json({ok:true,location:updated.deliveryLocation});
});
app.post("/api/orders/:id/verify-payment",auth,roles("customer"),async(req,res)=>{
 const o=await getOrder(req.params.id);if(!o)return res.status(404).json({error:"Order not found."});
 if(o.customerId!==req.auth.id)return res.status(403).json({error:"Not your order."});
 if(req.body?.qrToken!==o.qrToken)return res.status(400).json({error:"QR verification failed."});
 if(o.status!=="delivered")return res.status(409).json({error:"Delivery partner must mark the order delivered first."});
 const updated=await updateOrder(req.params.id,{paymentStatus:"demo-paid"});emitOrder(updated);res.json({ok:true,order:updated,message:"Demo payment confirmed. No real money was transferred."});
});
app.get("/api/orders/:id/qr",auth,async(req,res)=>{
 const o=await getOrder(req.params.id);if(!o)return res.status(404).json({error:"Order not found."});
 if(![o.customerId,o.deliveryPartnerId].includes(req.auth.id))return res.status(403).json({error:"Not allowed."});
 const data=await QRCode.toDataURL(JSON.stringify({orderId:o.id||o._id,token:o.qrToken,amount:o.total,mode:"DEMO"}));
 res.json({qr:data,token:o.qrToken,amount:o.total,mode:"DEMO"});
});
app.get("/api/nearby-delivery",(req,res)=>{
 const lat=Number(req.query.lat),lng=Number(req.query.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return res.status(400).json({error:"lat and lng required"});
 const partners=memory.users.filter(u=>u.role==="delivery"&&u.location).map(u=>({...publicUser(u),distanceKm:haversine({lat,lng},u.location)})).filter(u=>u.distanceKm<=4).sort((a,b)=>a.distanceKm-b.distanceKm);
 res.json({radiusKm:partners.some(p=>p.distanceKm<=2)?2:4,partners});
});
io.on("connection",socket=>{socket.emit("connection:ready",{ok:true});socket.on("order:subscribe",id=>socket.join("order:"+id));});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
server.listen(PORT,"0.0.0.0",()=>console.log(`Foodtrack running on http://localhost:${PORT}`));
