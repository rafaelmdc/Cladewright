"""Template context processors."""
import os


def app_version(request):
    """Expose the running build's version to every template (e.g. the admin header), so you
    can confirm at a glance which build is live. Baked into the image at build time."""
    return {"app_version": os.environ.get("APP_VERSION", "dev")}
