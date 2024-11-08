# Body fields

An action to display key value pairs in a pull request body.
Values are added in such a way that they can be updated as they change.

## Installation

Add a step like this to a workflow

```yaml
jobs:
  make-comments:
    runs-on: ubuntu-latest

    # these permissions are needed by the action
    permissions:
      issues: write
      pull-requests: write

    steps:
      # show some content in the PR body
      - uses: insidewhy/action-body-fields@v1
        with:
          fields: |
            Website: http://my-shoes-are-on-fire.com

      # append the content " (outdated)" to fields that have already been added and where they
      # are not already appended, after this the body will read:
      # `Website: http://my-shoes-are-on-fire.com (outdated)`
      - uses: insidewhy/action-body-fields@v1
        with:
          append-to-values: true
          fields: |
            Website: (outdated)
            Stories: (outdated)

      - name: do some work
        run: make build-stuff

      # update fields to these values
      - uses: insidewhy/action-body-fields@v1
        with:
          fields: |
            Website: http://adorable-cat-test-website.com
            Stories: http://stories.adorable-cat-test-website.com

      # add some fields at the start of the block, preserving the previous fields
      - uses: insidewhy/action-body-fields@v1
        with:
          fields: |
            At the top: you eat shirts
            Near the top: i have issues with wind chimes
          prepend: true

      # add some more fields to the bottom of the block
      - uses: insidewhy/action-body-fields@v1
        with:
          fields: |
            Neart the bottom: i am mouses
            At the bottom: you eat metaphor

      # remove some fields
      - uses: insidewhy/action-body-fields@v1
        with:
          remove-fields: Website,Stories
```
