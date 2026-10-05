import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
 for (const [code,name,brand,price,stock,category] of [["GB-DEMO-001","Yağ filtresi · örnek ürün","DEMO",18500,24,"filtre"],["GB-DEMO-002","Ön fren balatası · örnek ürün","DEMO",74000,12,"fren"],["GB-DEMO-003","Hava filtresi · örnek ürün","DEMO",29000,8,"filtre"]]) {
  await pool.query("INSERT INTO products (supplier,code,name,brand,description,price_kurus,stock,category) VALUES ('demo',$1,$2,$3,$4,$5,$6,$7) ON CONFLICT (supplier,code) DO NOTHING", [code,name,brand,"Yalnızca arayüzü denemek için hazırlanmış sentetik ürün. Gerçek stok, fiyat veya tedarikçi kaydı değildir.",price,stock,category]);
 }
 console.log("Three clearly labeled synthetic demo products created. No supplier data imported.");
} finally { await pool.end(); }
