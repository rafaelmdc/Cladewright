from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("gamedata", "0005_pipelinejob_kind_alter_pipelinejob_scope_filter_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="pipelinejob",
            name="delete_old",
            field=models.BooleanField(
                default=False,
                help_text="After this build becomes current, delete the scope's now-superseded "
                "(non-current) versions to reclaim DB space. Requires 'load current'; "
                "the new build is always kept.",
            ),
        ),
    ]
