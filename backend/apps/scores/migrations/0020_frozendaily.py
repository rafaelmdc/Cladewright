from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scores", "0019_namedspeciesset_speciestoken_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="FrozenDaily",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("date", models.DateField(help_text="The day this resolution applies to.", unique=True)),
                ("mode", models.CharField(choices=[("marathon_daily", "Marathon (daily)"), ("marathon_free", "Marathon (free play)"), ("classic", "Classic (daily)")], default="marathon_daily", max_length=32)),
                ("scope", models.CharField(help_text="The scope key this day was frozen to.", max_length=128)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name_plural": "Frozen dailies",
                "ordering": ["-date"],
            },
        ),
    ]
