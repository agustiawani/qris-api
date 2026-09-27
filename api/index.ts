import { Elysia, t } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import QRCode from 'qrcode';

// ==== Fungsi konversi QRIS statis → dinamis ====
// (Ini adalah logika inti repo idlanyor/qris-api)
function convertQris(staticQris: string, nominal: number): string {
  // Hapus whitespace/newline
  let qris = staticQris.replace(/\s/g, '');

  // Pastikan ini QRIS statis (biasanya diakhiri 6304 + CRC)
  // Kita ganti tag 54 (amount) dan hitung ulang CRC16
  const nominalStr = nominal.toFixed(0);

  // 1. Hapus CRC lama (4 karakter terakhir)
  qris = qris.slice(0, -4);

  // 2. Hapus tag 54 (amount) lama jika ada
  //    Tag 54 formatnya: 54 + panjang(2 digit) + nilai
  const tag54Regex = /54(\d{2})(\d+)/;
  const match = qris.match(tag54Regex);
  if (match) {
    const len = parseInt(match[1], 10);
    const fullTag = `54${match[1]}${match[2].slice(0, len)}`;
    qris = qris.replace(fullTag, '');
  }

  // 3. Tambahkan tag 54 baru dengan nominal
  const nominalLength = nominalStr.length.toString().padStart(2, '0');
  const newTag54 = `54${nominalLength}${nominalStr}`;

  // 4. Sisipkan tag 54 sebelum tag 58 (country code) atau 63 (CRC)
  //    Cara aman: sisipkan sebelum tag 58
  const tag58Index = qris.indexOf('5802ID');
  if (tag58Index !== -1) {
    qris = qris.slice(0, tag58Index) + newTag54 + qris.slice(tag58Index);
  } else {
    // Fallback: sisipkan sebelum "6304"
    qris = qris + newTag54;
  }

  // 5. Tambahkan kembali "6304" untuk CRC
  qris = qris + '6304';

  // 6. Hitung CRC16-CCITT (0xFFFF)
  const crc = crc16ccitt(qris);

  return qris + crc;
}

function crc16ccitt(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// ==== Aplikasi Elysia ====
const app = new Elysia({ aot: false })
  .use(cors())
  .use(
    swagger({
      documentation: {
        info: {
          title: 'QRIS API',
          version: '1.0.0',
          description: 'API konversi QRIS statis ke dinamis'
        }
      }
    })
  )
  .get('/', () => ({
    status: 'ok',
    message: 'QRIS API is running',
    docs: '/docs'
  }))
  .post(
    '/convert',
    async ({ body }) => {
      try {
        const { qris, nominal } = body;
        const dynamicQris = convertQris(qris, Number(nominal));
        const qrImage = await QRCode.toDataURL(dynamicQris, {
          width: 400,
          margin: 2
        });

        return {
          success: true,
          data: {
            qris: dynamicQris,
            nominal: Number(nominal),
            qrImage
          }
        };
      } catch (err: any) {
        return {
          success: false,
          error: err.message
        };
      }
    },
    {
      body: t.Object({
        qris: t.String(),
        nominal: t.Number()
      })
    }
  )
  .get(
    '/qr',
    async ({ query }) => {
      try {
        const dynamicQris = convertQris(query.qris, Number(query.nominal));
        const buffer = await QRCode.toBuffer(dynamicQris, {
          width: 400,
          margin: 2
        });

        return new Response(buffer, {
          headers: { 'Content-Type': 'image/png' }
        });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
    {
      query: t.Object({
        qris: t.String(),
        nominal: t.String()
      })
    }
  );

// ⚠️ PENTING: Jangan pakai app.listen() di Vercel.
// Cukup export default-nya saja.
export default app;
