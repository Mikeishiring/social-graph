#!/usr/bin/env python3
"""
Social Graph - Setup Script
One-command setup for the Temporal Twitter Network Atlas.
"""

import os
import sys
import subprocess
import platform
from pathlib import Path


def run_cmd(cmd: list[str], cwd: str = None, check: bool = True) -> bool:
    """Run a command and return success status."""
    try:
        print(f"  > {' '.join(cmd)}")
        subprocess.run(cmd, cwd=cwd, check=check, capture_output=False)
        return True
    except subprocess.CalledProcessError as e:
        print(f"  ERROR: Command failed with code {e.returncode}")
        return False
    except FileNotFoundError:
        print(f"  ERROR: Command not found: {cmd[0]}")
        return False


def check_python() -> bool:
    """Check Python version."""
    print("\n[1/6] Checking Python...")
    version = sys.version_info
    if version.major < 3 or (version.major == 3 and version.minor < 10):
        print(f"  ERROR: Python 3.10+ required, found {version.major}.{version.minor}")
        return False
    print(f"  OK: Python {version.major}.{version.minor}.{version.micro}")
    return True


def check_node() -> bool:
    """Check Node.js version."""
    print("\n[2/6] Checking Node.js...")
    try:
        result = subprocess.run(["node", "--version"], capture_output=True, text=True)
        version = result.stdout.strip()
        major = int(version.lstrip("v").split(".")[0])
        if major < 18:
            print(f"  ERROR: Node.js 18+ required, found {version}")
            return False
        print(f"  OK: Node.js {version}")
        return True
    except FileNotFoundError:
        print("  ERROR: Node.js not found. Install from https://nodejs.org/")
        return False


def setup_backend(project_root: Path) -> bool:
    """Install backend dependencies."""
    print("\n[3/6] Setting up backend...")
    backend_dir = project_root / "backend"

    # Create virtual environment if it doesn't exist
    venv_dir = backend_dir / "venv"
    if not venv_dir.exists():
        print("  Creating virtual environment...")
        if not run_cmd([sys.executable, "-m", "venv", "venv"], cwd=str(backend_dir)):
            return False

    # Determine pip path
    if platform.system() == "Windows":
        pip_path = venv_dir / "Scripts" / "pip.exe"
        python_path = venv_dir / "Scripts" / "python.exe"
    else:
        pip_path = venv_dir / "bin" / "pip"
        python_path = venv_dir / "bin" / "python"

    # Install dependencies
    print("  Installing Python dependencies...")
    if not run_cmd([str(pip_path), "install", "-r", "requirements.txt"], cwd=str(backend_dir)):
        return False

    # Install package (optional - for CLI access)
    print("  Installing social-graph package...")
    run_cmd([str(pip_path), "install", "-e", "src"], cwd=str(backend_dir), check=False)

    print("  OK: Backend ready")
    return True


def setup_frontend(project_root: Path) -> bool:
    """Install frontend dependencies."""
    print("\n[4/6] Setting up frontend...")
    frontend_dir = project_root / "frontend"

    # Check if node_modules exists
    if (frontend_dir / "node_modules").exists():
        print("  Node modules already installed")
    else:
        print("  Installing npm dependencies...")
        if not run_cmd(["npm", "install"], cwd=str(frontend_dir)):
            return False

    print("  OK: Frontend ready")
    return True


def setup_env(project_root: Path, api_key: str = None) -> bool:
    """Create .env file with API key."""
    print("\n[5/6] Configuring environment...")
    backend_dir = project_root / "backend"
    env_file = backend_dir / ".env"
    env_example = backend_dir / ".env.example"

    if env_file.exists() and not api_key:
        print("  .env file already exists")
        return True

    # Read example
    if env_example.exists():
        content = env_example.read_text()
    else:
        content = """# Social Graph Environment Configuration

# Database (SQLite by default)
SOCIAL_GRAPH_DATABASE_URL=sqlite:///./social_graph.db

# Twitter API - Get your key from https://twitterapi.io/
SOCIAL_GRAPH_TWITTER_BEARER_TOKEN=your_api_key_here

# Collection settings
SOCIAL_GRAPH_MAX_TOP_POSTS_PER_RUN=20
SOCIAL_GRAPH_MAX_ENGAGERS_PER_POST=500
"""

    if api_key:
        content = content.replace("your_api_key_here", api_key)
        content = content.replace("your_bearer_token_here", api_key)

    env_file.write_text(content)
    print(f"  Created {env_file}")

    if "your_api_key_here" in content or "your_bearer_token_here" in content:
        print("  NOTE: Edit backend/.env and add your TwitterAPI.io key")

    return True


def init_database(project_root: Path) -> bool:
    """Initialize the database."""
    print("\n[6/6] Initializing database...")
    backend_dir = project_root / "backend"

    # Determine python path
    if platform.system() == "Windows":
        python_path = backend_dir / "venv" / "Scripts" / "python.exe"
    else:
        python_path = backend_dir / "venv" / "bin" / "python"

    # Initialize database
    init_script = """
import sys
sys.path.insert(0, 'src')
from social_graph.database import init_db
init_db()
print("Database initialized")
"""

    result = subprocess.run(
        [str(python_path), "-c", init_script],
        cwd=str(backend_dir),
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        print(f"  ERROR: {result.stderr}")
        return False

    print("  OK: Database ready")
    return True


def print_next_steps(project_root: Path):
    """Print instructions for next steps."""
    print("\n" + "=" * 60)
    print("SETUP COMPLETE!")
    print("=" * 60)

    print("\n1. Add your TwitterAPI.io key to backend/.env")
    print("   Get a key at: https://twitterapi.io/")

    print("\n2. Start the backend:")
    if platform.system() == "Windows":
        print("   cd backend")
        print("   .\\venv\\Scripts\\activate")
        print("   uvicorn social_graph.api:app --reload --port 8000")
    else:
        print("   cd backend")
        print("   source venv/bin/activate")
        print("   uvicorn social_graph.api:app --reload --port 8000")

    print("\n3. Start the frontend (in another terminal):")
    print("   cd frontend")
    print("   npm run dev")

    print("\n4. Collect your network data:")
    print('   curl -X POST "http://localhost:8000/collect?username=YOUR_TWITTER_HANDLE"')

    print("\n5. Build visualization frames:")
    print('   curl -X POST "http://localhost:8000/frames/build"')

    print("\n6. Open http://localhost:5173 to see your network!")
    print()


def main():
    """Main setup entry point."""
    print("=" * 60)
    print("Social Graph - Setup")
    print("Temporal Twitter Network Atlas")
    print("=" * 60)

    # Get project root
    project_root = Path(__file__).parent.resolve()

    # Check for API key argument
    api_key = None
    if len(sys.argv) > 1:
        api_key = sys.argv[1]

    # Run setup steps
    steps = [
        check_python,
        check_node,
        lambda: setup_backend(project_root),
        lambda: setup_frontend(project_root),
        lambda: setup_env(project_root, api_key),
        lambda: init_database(project_root),
    ]

    for step in steps:
        if not step():
            print("\nSetup failed. Please fix the errors above and try again.")
            sys.exit(1)

    print_next_steps(project_root)


if __name__ == "__main__":
    main()
