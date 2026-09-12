# Domaine : [Nom du Domaine] ([slug]) — Contrats d'API & Schémas

> **Spécification Formelle :** [`./openapi.yaml`](./openapi.yaml) (OpenAPI 3.1)  
> **Base URL :** `[Base URL, ex: /api/v1/[domaine]]`  
> **Format d'échange :** `application/json`

---

## 1. Périmètre & Frontières des Contrats

* **Ressources & Endpoints gérés dans ce domaine :**
  * `[Ressource 1, ex: /api/v1/organisations]`
  * `[Ressource 2, ex: /api/v1/projects]`
* **Contrats délégués à d'autres domaines :**
  * *[Ressource déléguée] :* Délégué à `[autre-domaine]`.

---

## 2. Cartographie des Endpoints REST

| Méthode | Endpoint | OperationId | Auth | Description |
|---|---|---|:---:|---|
| `GET` | `[Path]` | `[operationId]` | `[Auth]` | [Description succincte du rôle de l'endpoint] |
| `POST` | `[Path]` | `[operationId]` | `[Auth]` | [Description succincte du rôle de l'endpoint] |

> ℹ️ **Spécification Formelle des Requêtes & Réponses :**  
> Les corps de requêtes, paramètres, modèles de données, codes de statut HTTP et schémas d'erreurs sont intégralement spécifiés dans [`./openapi.yaml`](./openapi.yaml).

---

## 3. Schémas de Validation Client / Consommateurs

*Schémas de validation et types contractuels dans le langage du client (ex: Zod / TypeScript, Pydantic / Python, JSON Schema, etc.) :*

```typescript
// Exemple de schémas de validation et types déduits
```

---

## 4. Modèle Standard d'Erreur

| Code HTTP | Format du Payload | Signification / Usage |
|---|---|---|
| `400 Bad Request` | `{ "code": "INVALID_INPUT", "message": "..." }` | Paramètres ou corps de requête invalide |
| `401 Unauthorized` | `{ "code": "UNAUTHORIZED", "message": "..." }` | Authentification requise ou jeton expiré |
| `403 Forbidden` | `{ "code": "FORBIDDEN", "message": "..." }` | Droits insuffisants pour accéder à la ressource |
| `404 Not Found` | `{ "code": "NOT_FOUND", "message": "..." }` | Ressource introuvable |
| `409 Conflict` | `{ "code": "CONFLICT", "message": "..." }` | Conflit d'état ou violation d'unicité |
| `422 Unprocessable` | `{ "code": "VALIDATION_FAILED", "violations": [...] }` | Échec des règles de validation métier |
