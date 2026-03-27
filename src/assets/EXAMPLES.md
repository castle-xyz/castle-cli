# YAML Examples Reference

Copy-paste patterns for common game logic. All examples show relevant blueprint YAML excerpts.

## New blueprint

`blueprints/bullet.yaml`:
```yaml
title: Bullet
drawing: red circle
components:
  Layout:
    widthScale: 0.4
    heightScale: 0.4
  Dynamic Motion:
    vy: -10
  Solid:
    disabled: false
```

## Variable with rule — scoring system

In `variables.yaml`, add the variable:
```yaml
- name: score
  initialValue: 0
  lifetime: play
```

In a blueprint's components, reference by name (not ID):
```yaml
components:
  Rules:
    rules:
      rule-0:
        trigger:
          name: collide
          behaviorName: Layout
          params:
            tag: player
        responses:
          - name: set variable
            behaviorName: Rules
            params:
              variableName: score
              setToValue:
                expression: variable + 1
                variableName: score
          - name: destroy
            behaviorName: Rules
            params: {}
```

## Display a variable as text

```yaml
components:
  Text:
    content: "Score: $score"
  Rules:
    rules:
      rule-0:
        trigger:
          name: variable changes
          behaviorName: Rules
          params:
            variableName: score
        responses:
          - name: set behavior property
            behaviorName: Rules
            params:
              behaviorName: Text
              propertyName: content
              value: "Score: $score"
```

## Create actor from another blueprint (use entryTitle not entryId)

```yaml
components:
  Rules:
    rules:
      rule-0:
        trigger:
          name: tap
          behaviorName: Layout
          params: {}
        responses:
          - name: create
            behaviorName: Rules
            params:
              entryTitle: Bullet
              coordinateSystem: relative position
              xOffset: 0
              yOffset: -1
```

## Collision with tag

```yaml
components:
  Tags:
    tagsString: enemy
  Rules:
    rules:
      rule-0:
        trigger:
          name: collide
          behaviorName: Layout
          params:
            tag: player
        responses:
          - name: destroy
            behaviorName: Rules
            params: {}
```

## Set behavior property on create (e.g. launch velocity)

```yaml
components:
  Rules:
    rules:
      rule-0:
        trigger:
          name: create
          behaviorName: Rules
          params: {}
        responses:
          - name: set behavior property
            behaviorName: Rules
            params:
              behaviorName: Dynamic Motion
              propertyName: vx
              value: 0
          - name: set behavior property
            behaviorName: Rules
            params:
              behaviorName: Dynamic Motion
              propertyName: vy
              value: -5
```

## Repeating action (e.g. spawn enemies every 2 seconds)

```yaml
components:
  Rules:
    rules:
      rule-0:
        trigger:
          name: create
          behaviorName: Rules
          params: {}
        responses:
          - name: infinite repeat
            behaviorName: Rules
            params:
              intervalType: time
              interval: 2
              responses:
                - name: create
                  behaviorName: Rules
                  params:
                    entryTitle: Enemy
                    coordinateSystem: absolute position
                    xOffset: 0
                    yOffset: -6
```
