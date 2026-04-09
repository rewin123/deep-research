import { Link, Outlet, useLocation } from 'react-router-dom';

export function Layout() {
  const location = useLocation();

  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="logo">
          Deep Research
        </Link>
        <nav className="nav">
          <Link
            to="/"
            className={location.pathname === '/' ? 'nav-link active' : 'nav-link'}
          >
            Sessions
          </Link>
          <Link
            to="/settings"
            className={location.pathname === '/settings' ? 'nav-link active' : 'nav-link'}
          >
            Settings
          </Link>
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
