---
name: bulma-java
description: Use when writing Java code that generates HTML with Bulma CSS components using the bulma-java library (com.github.t1:bulma-java). Triggers include imports of com.github.t1.bulmajava or com.github.t1.htmljava, or when generating server-side HTML with Bulma styling.
---

# bulma-java

Type-safe, fluent Java API for generating HTML with Bulma CSS components. Zero runtime dependencies in core.

## Maven

```xml

<dependency>
    <groupId>com.github.t1</groupId>
    <artifactId>bulma-java</artifactId>
    <version>${bulma-java.version}</version>
</dependency>
```

This is the only dependency you need. It transitively includes `java-html` which provides the core HTML elements (`div`,
`ul`, `li`, `span`, `p`, `strong`, `em`, `html`, etc.) — all under the `com.github.t1.htmljava` package. Both packages are part of the
same library.

## Quick Reference — Imports

```java
// Core HTML (provided by java-html, included transitively)

import static com.github.t1.htmljava.Html.html;
import static com.github.t1.htmljava.HtmlBasics.*;  // div, span, p, ul, li, h1-h6, strong, em, nav, header, footer, etc.
import static com.github.t1.htmljava.Anchor.a;

// Bulma layout
import static com.github.t1.bulmajava.layout.Section.section;
import static com.github.t1.bulmajava.layout.Container.container;
import static com.github.t1.bulmajava.layout.Hero.hero;

// Bulma columns
import static com.github.t1.bulmajava.columns.Columns.columns;
import static com.github.t1.bulmajava.columns.Column.column;

// Bulma elements
import static com.github.t1.bulmajava.elements.Title.*;    // title(), subtitle()
import static com.github.t1.bulmajava.elements.Button.button;
import static com.github.t1.bulmajava.elements.Box.box;
import static com.github.t1.bulmajava.elements.Tag.*;      // tag(), tags(), tagsAddon()
import static com.github.t1.bulmajava.elements.Block.block;
import static com.github.t1.bulmajava.elements.Content.content_;
import static com.github.t1.bulmajava.elements.Delete.delete;
import static com.github.t1.bulmajava.elements.Icon.icon;
import static com.github.t1.bulmajava.elements.Image.*;    // image(), img(), figure()
import static com.github.t1.bulmajava.elements.Notification.notification;
import static com.github.t1.bulmajava.elements.ProgressBar.progress;
import static com.github.t1.bulmajava.elements.Table.*;    // table(), row(), td(), th(), tbody()

// Bulma components
import static com.github.t1.bulmajava.components.Navbar.navbar;
import static com.github.t1.bulmajava.components.Menu.menu;
import static com.github.t1.bulmajava.components.Breadcrumb.breadcrumb;
import static com.github.t1.bulmajava.components.Dropdown.dropdown;
import static com.github.t1.bulmajava.components.Message.message;
import static com.github.t1.bulmajava.components.Pagination.pagination;
import static com.github.t1.bulmajava.components.Panel.panel;

// Bulma layout (additional)
import static com.github.t1.bulmajava.layout.Footer.footer;
import static com.github.t1.bulmajava.layout.Level.level;
import static com.github.t1.bulmajava.layout.Media.media;

// Bulma grid
import static com.github.t1.bulmajava.grid.Grid.*;         // grid(), fixedGrid(), cell()

// Bulma form
import static com.github.t1.bulmajava.form.Form.form;
import static com.github.t1.bulmajava.form.Field.field;
import static com.github.t1.bulmajava.form.Input.input;
import static com.github.t1.bulmajava.form.InputType.*;
import static com.github.t1.bulmajava.form.Checkbox.checkbox;
import static com.github.t1.bulmajava.form.Select.select;
import static com.github.t1.bulmajava.form.Textarea.textarea;

// Modifiers
import static com.github.t1.bulmajava.basic.Color.*;   // PRIMARY, LINK, INFO, SUCCESS, WARNING, DANGER
import static com.github.t1.bulmajava.basic.Size.*;    // SMALL, NORMAL, MEDIUM, LARGE
import static com.github.t1.bulmajava.basic.Style.*;   // LIGHT, DARK, ROUNDED, FULLWIDTH, etc.
```

## Element Types

Type hierarchy: `Renderable` → `AbstractElement<SELF>` → `Element`

- `HtmlBasics.*` factories (`div()`, `ul()`, `li()`, `span()`, `p()`, etc.) return `com.github.t1.htmljava.Element`
- `Element` extends `AbstractElement<Element>` which has all the builder methods: `.content()`, `.attr()`, `.id()`,
  `.classes()`, `.style()`, etc.
- `Renderable` is the base interface — has only `.render()`. Use it for return types or collections, but you lose
  builder methods.
- Bulma components (`section()`, `container()`, `button()`, etc.) return their own types extending `AbstractElement`

**Use `Element` (not `Renderable`) when you need to chain builder methods:**

```java
import com.github.t1.htmljava.Element;

Element list=ul();
        list.content(li("item 1"));       // .content() works on Element
        list.attr("role","tree");        // .attr() works on Element
        list.style("display:none");       // .style() works on Element
        list.id("my-list");               // .id() works on Element
        list.classes("custom");           // .classes() works on Element

// For mixed collections or return types where you don't need builder methods:
import com.github.t1.htmljava.Renderable;

Renderable fragment = div().content(p("Hello"));
```

**Key `.content()` overloads on `AbstractElement`:**

- `.content(String)` — text content
- `.content(Renderable)` — single child
- `.content(Renderable...)` — varargs children
- `.content(Collection<? extends Renderable>)` — collection of children
- `.content(Stream<? extends Renderable>)` — stream of children

**Content querying methods on `AbstractElement`:**

- `.content()` — returns the raw `Renderable` content (null if empty)
- `.contentStream()` — returns `Stream<Renderable>` of all children (empty stream if none)
- `.contentIsA(Class<T>)` — tests if content is of a specific type
- `.contentAs(Class<T>)` — casts content to a specific type
- `.findElement(String className)` — finds child by CSS class, returns `Optional<AbstractElement<?>>`
- `.findElement(Predicate<AbstractElement<?>>)` — finds child by predicate, returns `Optional`
- `.getOrCreate(String className)` — gets existing child by class or creates a default div
- `.getOrCreate(String className, Supplier<T>)` — gets or creates with custom factory
- `.getOrCreate(Predicate<AbstractElement<?>>, Supplier<T>)` — gets or creates with predicate
- `.notClasses(String...)` — removes CSS classes; removes the `class` attribute entirely if empty
- `.hasAttribute(String key)` — checks if attribute with given key exists (on `AbstractElement` directly)
- `.hasAttribute(String key, String value)` — checks if attribute with given key and value exists (on `AbstractElement`
  directly)
- `.findAttribute(String name)` — returns `Optional<Attribute>` for the named attribute
- `.attributes()` — returns the `@NonNull Attributes` object (never null)
    - `.hasAttribute(String key)` — checks if an attribute with the given key exists
    - `.hasAttribute(String key, String value)` — checks if an attribute with the given key and value exists
    - `.findAttribute(Predicate<Attribute>)` — returns `Optional<Attribute>`

## Rendering

Call `.render()` on any element. Returns a `String`.

```java
// Full page — produces <!DOCTYPE html><html>...</html>
String page = html("Page Title").body(div().content(p("Hello"))).render();

// Fragment — no doctype/html/head wrapper
String fragment = div().content(p("Hello")).render();
```

## Building Pages

```java
html("My App")
    .stylesheet("https://cdn.jsdelivr.net/npm/bulma@1.0.0/css/bulma.min.css")
    .script("app.js")
    .body(
        section().content(container().content(
            title("Welcome"),
            p("Hello world")
        ))
    )
    .render();
```

### Adding Body Content

There are several ways to add content to the `<body>` of an `Html` page, each useful in different situations:

**Multiple elements** — the most common case with several top-level children:
```java
html("My App").body(navbar(), section(), footer())
```

**Single element** — when the body has one root element:
```java
html("My App").body(section().content(title("Hello")))
```

**Chained calls** — building up the body incrementally:
```java
html("My App")
    .body(navbar())
    .body(section())
    .body(footer())
```

**Implicit routing** — `content()` on `Html` automatically routes to the body:
```java
html("My App").content(h1("Hello"))  // equivalent to .body(h1("Hello"))
```

**Body with attributes** — when you need classes or attributes on the `<body>` tag itself,
pass an explicit `Body` element via `content()`:
```java
html("My App").content(body().has(NAVBAR_FIXED_TOP).content(
    container().content(section().content(title("Hello")))
))
```

**Functional modification** — an alternative for setting body attributes inline:
```java
html("My App").body(e -> e.classes("custom").content(h1("Hello")))
```

**Positional insertion** — insert at a specific position (0 = first):
```java
html("My App").body(section()).body(navbar(), 0)  // navbar before section
```

**Retrieve and mutate** — get the existing body element for later modification:
```java
var page = html("My App").body(section());
page.body().content(footer());  // add to existing body
```

## Custom Attributes

```java
div().

id("main").

classes("custom-class").

attr("data-value","42").

attr("hx-get","/api")

a("Link text").

href("/path")     // Anchor has a dedicated .href() method
```

## Columns (Responsive)

```java
// Auto-sized columns
columns().

content(
        column().

content(p("Left")),

column().

content(p("Right"))
        )

// Sized columns — use .classes() for Bulma column size classes
column().

classes("is-one-third").

content(sidebar)

column().

classes("is-two-thirds").

content(main)

// Desktop-only side-by-side (stacks on mobile/tablet)
columns().

classes("is-desktop").

content(
        column().

classes("is-one-quarter").

content(sidebar),

column().

content(mainContent)
)
```

Available size classes: `is-1` through `is-12`, `is-one-third`, `is-two-thirds`, `is-one-quarter`, `is-three-quarters`,
`is-half`, `is-narrow`.

## Forms

```java
form().

post("/submit").

content(
        field("Username").

content(input(TEXT).

attr("name","user").

placeholder("Enter name")),

field("Email").

content(input(EMAIL).

attr("name","email"))
        .

help("We won't share this"),

field("Role").

content(select("role")

        .

option("admin","Admin")
        .

option("user","User")),

field().

content(button("Submit").

is(PRIMARY))
        )
```

Key form patterns:

- `field(label)` creates labeled field with a plain string; `field()` for no label
- `.label(Renderable...)` sets a rich label with arbitrary content (e.g. spans, tags). The label is rendered as
  `<label class="label">` *before* the control divs, preserving standard Bulma spacing:
  ```java
  field().label(span("petId"), tag("path"))
      .content(input(TEXT).attr("name", "petId"))
  ```
- `.content(control)` wraps in Bulma `control` div
- `.help(text)` adds help text below
- `.iconLeft(name)` / `.iconRight(name)` for icons
- `input(type).attr("name", fieldName)` sets the name attribute
- `checkbox().name(fieldName)` creates a Bulma checkbox (`<label class="checkbox"><input type="checkbox" ...></label>`).
  Use `.checked()` for pre-checked state, `.disabled()` to disable. Do **not** use `input(CHECKBOX)` directly — it adds
  the `.input` class which is wrong for checkboxes.

## Modifiers

```java
button("Click").

is(PRIMARY, LARGE)    // class="button is-primary is-large"

button("Ghost").

is(GHOST)

div().

is(LIGHT)
```

## Elements

| Element      | Factory                                                                      | Usage                                                                                                                                                                                                            |
|--------------|------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Box          | `box()`, `box(text)`, `articleBox()`                                         | Card-like container with shadow and border. Dark mode compatible.                                                                                                                                                |
| Tag          | `tag(text)`, `tag()`, `tags()`, `tagsAddon()`                                | Colored labels. Use `.is(SUCCESS)`, `.is(DANGER)`, etc. for colors. `tags()` wraps multiple tags. See Tag Patterns section.                                                                                      |
| Block        | `block()`, `blockP()`                                                        | Spacer: `margin-bottom: 1.5rem` (except `:last-child`). Use as a lightweight neutral container when you need vertical rhythm between siblings without shadow or padding (unlike `box()`). `blockP()` uses `<p>`. |
| Content      | `content_()`                                                                 | Wrapper for rendered HTML content (typography). Note trailing underscore.                                                                                                                                        |
| Delete       | `delete()`, `close()`                                                        | Close/delete button (×).                                                                                                                                                                                         |
| Icon         | `icon(name, ...)`                                                            | Font Awesome icon. Takes icon name and optional `IconStyle`/`FontSize`.                                                                                                                                          |
| Image        | `image(dim, src, alt)`, `img(src, alt)`, `figure()`                          | Image with Bulma figure wrapper.                                                                                                                                                                                 |
| Notification | `notification()`                                                             | Alert/notification box. Color via `.is(WARNING)` etc.                                                                                                                                                            |
| ProgressBar  | `progress(value, max)`                                                       | Progress bar. Color via `.is(PRIMARY)` etc.                                                                                                                                                                      |
| Table        | `table()`, `row(cells...)`, `td()`, `th()`, `tbody()`                        | Bulma-styled table. `row()` creates `<tr>` with `<td>` children.                                                                                                                                                 |
| Title        | `title(text)`, `title(size, text)`, `subtitle(text)`, `subtitle(size, text)` | Heading elements. Size 1–6 via factory: `title(1, "Big")`, `subtitle(6, "Small")`.                                                                                                                               |
| Button       | `button(text)`                                                               | Button element. Color, size, style via `.is(...)`.                                                                                                                                                               |

## Tag Patterns

**Sizes:** Tags only support `is-normal`, `is-medium`, and `is-large`. There is no `is-small` — the default is already
the smallest size. Do not override tag font-size or padding with custom CSS — it breaks delete buttons and addon
proportions that are designed for the default size.

**Deletable tags (two patterns):**

```java
// Pattern 1: Delete as a separate addon tag — clean ✕ circle
tagsAddon()
    .content(tag("header"))
    .content(tag("custom").is(INFO))
    .content(element("a").classes("tag", "is-delete"))

// Pattern 2: Delete button inside a tag — ✕ appears after the text
tag("custom").is(INFO)
    .content(delete().is(SMALL))
```

Pattern 1 renders `<a class="tag is-delete"></a>` as a separate addon — a standalone ✕ circle. Pattern 2 renders
`<button class="delete is-small">` inside the tag span. Both work at default tag size. **Avoid overriding tag sizes
with custom CSS** — at non-standard sizes, `is-delete` pseudo-elements render poorly (e.g. as a backslash instead
of ✕).

**Right-aligning badges in field labels:** Bulma's `.label` is `display: block` by default. To push `tagsAddon()` to the
right edge of a field, make the label a flex container:

```css
.field > .label {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
```

Do **not** use `is-inline-flex` on the `.tags` container for right-alignment — it makes the container shrink-to-fit,
preventing `margin-left: auto` or `space-between` from pushing it right.

## Components

| Component  | Factory                               | Key methods                                                            |
|------------|---------------------------------------|------------------------------------------------------------------------|
| Navbar     | `navbar(menuId)`                      | `.brand()`, `.burger()`, `.start()`, `.end()`                          |
| Menu       | `menu()`                              | `.label(text)`, `.content(items)`                                      |
| Card       | `Card.card()`                         | `.header()`, `.content()`, `.footer()`                                 |
| Modal      | `Modal.modal()`                       | `.content()`                                                           |
| Tabs       | `Tabs.tabs()`                         | content with `li` elements                                             |
| Hero       | `hero()`                              | `.head()`, `.body()`, `.foot()`, `.is(PRIMARY)`                        |
| Breadcrumb | `breadcrumb()`                        | content with `li`/`a` elements                                         |
| Dropdown   | `dropdown(id)`, `dropdown(id, label)` | Dropdown menu. `dropup()` variant.                                     |
| Message    | `message()`, `messageBody()`          | Colored message box (see Message section below). Color via `.is(...)`. |
| Pagination | `pagination(current, total, perPage)` | Auto-generated page links.                                             |
| Panel      | `panel()`, `panel(heading)`           | Sidebar panel with heading.                                            |

## Layout

| Layout    | Factory                                              | Notes                                                            |
|-----------|------------------------------------------------------|------------------------------------------------------------------|
| Section   | `section()`                                          | Page section wrapper                                             |
| Container | `container()`                                        | Centered content container                                       |
| Hero      | `hero()`                                             | Banner section                                                   |
| Columns   | `columns()` / `column()`                             | Responsive grid (see Columns section)                            |
| Footer    | `footer()`                                           | Page footer                                                      |
| Level     | `level()`                                            | Horizontal alignment with vertical centering (see Level section) |
| Media     | `media()`                                            | Media object (image + content)                                   |
| Grid      | `grid()`, `fixedGrid()`, `fixedGrid(cols)`, `cell()` | CSS Grid layout. `cell()` creates grid children.                 |

## Level

Horizontal bar that vertically centers its children and distributes them with `justify-content: space-between`. Prefer
`level()` over `div().classes("is-flex", "is-align-items-center")` when you want items spread across a row — it is more
idiomatic to Bulma.

```java
// Button on the left, status text pushed to the right
level().

content(
        button("Send").

is(PRIMARY),

span("200 OK").

classes("has-text-success")
)
```

With a single child the item stays left-aligned. When a second child is added (e.g. dynamically via JS), `space-between`
pushes it to the right automatically — no `margin-left: auto` needed.

## Message

The Message component requires **both** `message()` and `messageBody()` together. Neither works alone:

- `message()` renders `<article class="message">` — the outer wrapper only
- `messageBody()` renders `<div class="message-body">` — the styled content area

```java
// Correct — both wrapper and body:
message().

is(SUCCESS).

content(messageBody().

content(
        p("Operation completed successfully.")
))

// WRONG — messageBody() alone gets no Bulma styling:
messageBody().

is(SUCCESS).

content(p("No styles applied"))

// WRONG — message() without messageBody() inside also gets no body styling:
message().

is(SUCCESS).

content(p("No body styles applied"))
```

Use `message()` with a header for titled messages:

```java
message().

is(DANGER).

content(
        div().

classes("message-header").

content(p("Error")),

messageBody().

content(p("Something went wrong."))
        )
```

## Dark Mode

Not built into the library. Handle via CSS:

- Use Bulma's `prefers-color-scheme` media query support
- Or set `data-theme` attribute on `<html>` via `.attr("data-theme", "dark")`

## Component-First Principle

Prefer Bulma's semantic components over utility classes and custom CSS. The priority order is:

1. **Bulma components** — `panel()`, `box()`, `message()`, `content_()`, `block()`, etc. These provide built-in spacing,
   colors, and responsive behavior.
2. **Bulma utility classes** — `px-3`, `mt-4`, `has-text-centered`, etc. Use as a fallback when no component fits.
3. **Custom CSS** — only when neither components nor utilities cover the need.

Before adding `px-3` or writing `.my-custom-padding`, ask: is there a Bulma component that already provides this
spacing/styling?

## Common Mistakes

- **Don't bypass HTML escaping** - Only use `unsafeAppend()` or `UnsafeString` for trusted HTML content, never for
  user-provided content. **VERY IMPORTANT**
- Using `html()` for fragments — produces full document with doctype. Use element factories directly (`div()`,
  `section()`, etc.) for partials.
- Forgetting `.render()` — elements are builders, not strings.
- All text content is auto-escaped for XSS safety. To inject raw HTML, check the library for an unescaped content
  method.
- Reaching for utility classes (`px-3`, `mt-4`) or custom CSS before checking if a Bulma component already handles the
  spacing/styling.
- Overriding `.tag` font-size/padding with custom CSS — breaks `is-delete` addon rendering. Use default tag sizes.
- Using `is-inline-flex` on `.tags` when trying to right-align badges — prevents `margin-left: auto` from working.
  Use `justify-content: space-between` on the parent flex container instead.
