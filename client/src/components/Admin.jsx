import { Link } from "react-router-dom";

// Placeholder for the admin area — image upload + exercise creation lands here next.
export default function Admin() {
  return (
    <div style={{ padding: "2rem" }}>
      <h1>Admin</h1>
      <p>Exercise creation (image upload) will live here.</p>
      <Link to="/">← Back to studio</Link>
    </div>
  );
}
