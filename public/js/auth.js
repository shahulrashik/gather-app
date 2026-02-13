// Shared auth utilities
async function getUser() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    return data.user;
  } catch {
    return null;
  }
}

async function updateNav() {
  const user = await getUser();
  const nav = document.getElementById('nav-actions');
  if (!nav) return user;

  const existing = nav.innerHTML;

  if (user) {
    nav.innerHTML = `
      <a href="/my-events" class="btn btn-ghost btn-sm">My Events</a>
      <a href="/create" class="btn btn-outline btn-sm">Create Event</a>
      <div style="position: relative; display: inline-block;">
        <button class="btn btn-ghost btn-sm" id="user-menu-btn" style="display: flex; align-items: center; gap: 6px;">
          <span style="width: 28px; height: 28px; border-radius: 50%; background: var(--accent-bg); color: var(--accent); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.75rem;">${user.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)}</span>
          ${user.name.split(' ')[0]}
        </button>
      </div>
    ` + existing;

    document.getElementById('user-menu-btn').addEventListener('click', async () => {
      if (confirm('Log out?')) {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/';
      }
    });
  } else {
    nav.innerHTML = `
      <a href="/login" class="btn btn-ghost btn-sm">Log in</a>
      <a href="/signup" class="btn btn-primary btn-sm">Sign up</a>
    ` + existing;
  }

  return user;
}

function requireLogin(redirectTo) {
  return getUser().then(user => {
    if (!user) {
      window.location.href = `/login?redirect=${encodeURIComponent(redirectTo || window.location.pathname)}`;
      return null;
    }
    return user;
  });
}
