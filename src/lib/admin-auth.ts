import { NextRequest, NextResponse } from "next/server";

function isAdminPath(pathname: string): boolean {
  return pathname.startsWith("/admin");
}

function isProtectedApiRequest(pathname: string, method: string): boolean {
  if (pathname === "/api/requests") {
    return ["GET", "PATCH", "DELETE"].includes(method.toUpperCase());
  }
  if (pathname.match(/^\/api\/requests\/[^/]+$/)) {
    return ["PATCH", "DELETE"].includes(method.toUpperCase());
  }
  if (pathname.startsWith("/api/admin/")) {
    return true;
  }
  return false;
}

function checkAuth(request: NextRequest): boolean {
  const username = process.env.ADMIN_USERNAME ?? "";
  const password = process.env.ADMIN_PASSWORD ?? "";

  if (!username || !password) return false;

  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Basic ")) return false;

  try {
    const encoded = authHeader.slice(6);
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const [inputUser, inputPass] = decoded.split(":", 2);
    return inputUser === username && inputPass === password;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  const needsAuth =
    isAdminPath(pathname) || isProtectedApiRequest(pathname, method);

  if (!needsAuth) return NextResponse.next();

  if (!checkAuth(request)) {
    if (isAdminPath(pathname)) {
      const response = new NextResponse(
        `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Admin Girişi</title><style>body{font-family:system-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb}</style></head><body><form method="post" style="background:#fff;padding:2rem;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);min-width:300px"><h2 style="margin:0 0 1.5rem;font-size:1.25rem">Admin Girişi</h2><p style="color:#6b7280;font-size:.875rem;margin:0 0 1rem">Bu alan yetkili kullanıcılar içindir.</p><script>document.addEventListener('submit',function(e){var u=document.getElementById('u').value;var p=document.getElementById('p').value;var t=btoa(u+':'+p);e.target.action=e.target.baseURI;var h='Basic '+t;fetch(e.target.action,{method:'GET',headers:{Authorization:h}}).then(function(r){if(r.ok)window.location.reload();else{var m=document.getElementById('msg');m.textContent='Hatalı kullanıcı adı veya şifre';m.style.display='block';}}).catch(function(){var m=document.getElementById('msg');m.textContent='Bağlantı hatası';m.style.display='block';});e.preventDefault();});</script><label for="u" style="display:block;font-size:.875rem;font-weight:500;margin-bottom:.25rem">Kullanıcı Adı</label><input id="u" type="text" required style="display:block;width:100%;padding:.5rem;border:1px solid #d1d5db;border-radius:4px;font-size:.875rem;margin-bottom:1rem;box-sizing:border-box"/><label for="p" style="display:block;font-size:.875rem;font-weight:500;margin-bottom:.25rem">Şifre</label><input id="p" type="password" required style="display:block;width:100%;padding:.5rem;border:1px solid #d1d5db;border-radius:4px;font-size:.875rem;margin-bottom:1rem;box-sizing:border-box"/><div id="msg" style="display:none;color:#dc2626;font-size:.875rem;margin-bottom:1rem"></div><button type="submit" style="width:100%;padding:.625rem;background:#000;color:#fff;border:none;border-radius:4px;font-size:.875rem;cursor:pointer">Giriş Yap</button></form></body></html>`,
        {
          status: 401,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        }
      );
      return response;
    }

    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return NextResponse.next();
}
