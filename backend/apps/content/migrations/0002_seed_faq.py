"""Seed a few starter FAQ entries so the page isn't empty on first deploy. Admins can edit,
reorder, hide, or delete these freely. Idempotent on question; reversible."""
from django.db import migrations

SEED = [
    ("How do I play?",
     "Type the name of any animal — common or scientific — and it lands on the tree of life. "
     "Place as many as you can before the clock runs out. Naming a species near ones you've "
     "already placed keeps a combo going for bonus time and points."),
    ("How does scoring work?",
     "Your base score is the species and clades you place, plus combo and clade-completion "
     "bonuses. That base is then multiplied by your run's setup: modifiers and harder-than-"
     "default settings push it above 1×, easier settings below. A tougher run is worth more."),
    ("What's the difference between Common and Scientific?",
     "Common shows everyday names (\"lion\"); Scientific accepts only the Latin binomial "
     "(\"Panthera leo\") and is harder to recognise. Each has its own leaderboard."),
    ("What are modifiers?",
     "Optional challenges you switch on in the lobby — like No tree, which hides the cladogram "
     "and leaves only a list of what you've named. Each modifier changes the game and carries a "
     "score multiplier."),
    ("Why didn't my run show on the leaderboard?",
     "Runs are checked for a valid session and a believable placement pace before they rank. "
     "A run that doesn't pass still counts toward your profile stats — it just isn't placed on "
     "the board."),
]


def add(apps, schema_editor):
    FaqEntry = apps.get_model("content", "FaqEntry")
    for i, (q, a) in enumerate(SEED):
        FaqEntry.objects.get_or_create(question=q, defaults={"answer": a, "order": i})


def remove(apps, schema_editor):
    FaqEntry = apps.get_model("content", "FaqEntry")
    FaqEntry.objects.filter(question__in=[q for q, _ in SEED]).delete()


class Migration(migrations.Migration):
    dependencies = [("content", "0001_initial")]
    operations = [migrations.RunPython(add, remove)]
