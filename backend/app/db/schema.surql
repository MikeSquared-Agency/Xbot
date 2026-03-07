-- ==========
-- KNOWLEDGE GRAPH: Legal Doctrine
-- ==========

-- Legal domains (contract law, tort law, regulatory, IP, data protection)
DEFINE TABLE legal_domain SCHEMAFULL;
DEFINE FIELD name ON legal_domain TYPE string;
DEFINE FIELD description ON legal_domain TYPE string;
DEFINE FIELD jurisdiction ON legal_domain TYPE string;       -- "UK", "EU", "US", "global"
DEFINE FIELD volatility ON legal_domain TYPE string;         -- "settled", "evolving", "untested"
DEFINE FIELD relevance_to_agents ON legal_domain TYPE string;
DEFINE INDEX idx_legal_domain_name ON legal_domain FIELDS name;

-- Specific legal principles / doctrines
DEFINE TABLE doctrine SCHEMAFULL;
DEFINE FIELD name ON doctrine TYPE string;
DEFINE FIELD domain ON doctrine TYPE string;                  -- FK to legal_domain
DEFINE FIELD description ON doctrine TYPE string;
DEFINE FIELD jurisdiction ON doctrine TYPE string;
DEFINE FIELD precedent_status ON doctrine TYPE string;        -- "established", "analogous", "untested", "conflicting"
DEFINE FIELD agent_relevance ON doctrine TYPE string;         -- how this doctrine applies to AI agents
DEFINE FIELD risk_direction ON doctrine TYPE string;          -- "increases_liability", "decreases_liability", "uncertain"
DEFINE FIELD key_cases ON doctrine TYPE array<string>;        -- case names
DEFINE FIELD key_statutes ON doctrine TYPE array<string>;     -- legislation references
DEFINE INDEX idx_doctrine_name ON doctrine FIELDS name;
DEFINE INDEX idx_doctrine_domain ON doctrine FIELDS domain;

-- Relationships between doctrines
DEFINE TABLE doctrine_relates TYPE RELATION IN doctrine OUT doctrine;
DEFINE FIELD relationship ON doctrine_relates TYPE string;    -- "supports", "conflicts", "modifies", "extends"
DEFINE FIELD description ON doctrine_relates TYPE string;

-- ==========
-- KNOWLEDGE GRAPH: Regulatory Frameworks
-- ==========

DEFINE TABLE regulation SCHEMAFULL;
DEFINE FIELD name ON regulation TYPE string;
DEFINE FIELD short_name ON regulation TYPE string;            -- "EU AI Act", "GDPR", "FCA Consumer Duty"
DEFINE FIELD jurisdiction ON regulation TYPE string;
DEFINE FIELD status ON regulation TYPE string;                -- "in_force", "partial", "proposed", "guidance_only"
DEFINE FIELD effective_date ON regulation TYPE option<string>;
DEFINE FIELD enforcer ON regulation TYPE string;              -- "EU AI Office", "ICO", "FCA", "FTC"
DEFINE FIELD max_penalty ON regulation TYPE option<string>;   -- "6% global turnover", "$50M", etc.
DEFINE FIELD agent_relevance ON regulation TYPE string;
DEFINE FIELD compliance_requirements ON regulation TYPE array<string>;
DEFINE INDEX idx_regulation_name ON regulation FIELDS short_name;

-- Regulation applies_to risk categories
DEFINE TABLE regulates TYPE RELATION IN regulation OUT risk_factor;
DEFINE FIELD requirement ON regulates TYPE string;
DEFINE FIELD severity ON regulates TYPE string;               -- "mandatory", "recommended", "best_practice"

-- ==========
-- KNOWLEDGE GRAPH: Risk Factors
-- ==========

-- Risk factor taxonomy
DEFINE TABLE risk_category SCHEMAFULL;
DEFINE FIELD name ON risk_category TYPE string;               -- "technical", "legal_exposure", "market", "mitigation"
DEFINE FIELD description ON risk_category TYPE string;
DEFINE INDEX idx_risk_cat ON risk_category FIELDS name;

DEFINE TABLE risk_factor SCHEMAFULL;
DEFINE FIELD name ON risk_factor TYPE string;
DEFINE FIELD category ON risk_factor TYPE string;             -- FK to risk_category
DEFINE FIELD description ON risk_factor TYPE string;
DEFINE FIELD measurement ON risk_factor TYPE string;          -- how to assess this factor
DEFINE FIELD weight ON risk_factor TYPE float;                -- 0.0-1.0 importance in pricing
DEFINE FIELD levels ON risk_factor TYPE array<object>;        -- [{level: "low", score: 0.2, criteria: "..."}, ...]
DEFINE INDEX idx_risk_name ON risk_factor FIELDS name;
DEFINE INDEX idx_risk_category ON risk_factor FIELDS category;

-- Risk factors can amplify each other
DEFINE TABLE amplifies TYPE RELATION IN risk_factor OUT risk_factor;
DEFINE FIELD multiplier ON amplifies TYPE float;              -- how much factor A amplifies factor B
DEFINE FIELD description ON amplifies TYPE string;

-- ==========
-- KNOWLEDGE GRAPH: Mitigation Patterns
-- ==========

DEFINE TABLE mitigation SCHEMAFULL;
DEFINE FIELD name ON mitigation TYPE string;
DEFINE FIELD category ON mitigation TYPE string;              -- "legal_conformity", "human_oversight", "architectural", "evidentiary"
DEFINE FIELD description ON mitigation TYPE string;
DEFINE FIELD effectiveness ON mitigation TYPE float;          -- 0.0-1.0 how much it reduces risk
DEFINE FIELD implementation_cost ON mitigation TYPE string;   -- "trivial", "moderate", "significant", "major"
DEFINE FIELD prerequisites ON mitigation TYPE array<string>;
DEFINE INDEX idx_mitigation_name ON mitigation FIELDS name;
DEFINE INDEX idx_mitigation_category ON mitigation FIELDS category;

-- Mitigation reduces risk factor
DEFINE TABLE mitigates TYPE RELATION IN mitigation OUT risk_factor;
DEFINE FIELD reduction ON mitigates TYPE float;               -- 0.0-1.0 how much this mitigation reduces this specific risk
DEFINE FIELD conditions ON mitigates TYPE option<string>;     -- conditions under which mitigation is effective

-- ==========
-- OPERATIONAL: Deployment Assessments
-- ==========

DEFINE TABLE assessment SCHEMAFULL;
DEFINE FIELD session_id ON assessment TYPE string;
DEFINE FIELD user_id ON assessment TYPE string;
DEFINE FIELD company_name ON assessment TYPE option<string>;
DEFINE FIELD deployment_description ON assessment TYPE string;
DEFINE FIELD status ON assessment TYPE string;                -- "running", "completed", "failed"
DEFINE FIELD created_at ON assessment TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON assessment TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_assessment_session ON assessment FIELDS session_id UNIQUE;

-- Structured intake data extracted from description
DEFINE TABLE deployment_profile SCHEMAFULL;
DEFINE FIELD session_id ON deployment_profile TYPE string;
DEFINE FIELD agent_description ON deployment_profile TYPE string;
DEFINE FIELD tools ON deployment_profile TYPE array<object>;
DEFINE FIELD data_access ON deployment_profile TYPE array<string>;
DEFINE FIELD autonomy_level ON deployment_profile TYPE string;
DEFINE FIELD output_reach ON deployment_profile TYPE string;
DEFINE FIELD sector ON deployment_profile TYPE string;
DEFINE FIELD jurisdictions ON deployment_profile TYPE array<string>;
DEFINE FIELD human_oversight_model ON deployment_profile TYPE option<string>;
DEFINE FIELD existing_guardrails ON deployment_profile TYPE array<string>;
DEFINE FIELD vendor_contracts ON deployment_profile TYPE array<object>;
DEFINE INDEX idx_profile_session ON deployment_profile FIELDS session_id;

-- Risk scores per assessment
DEFINE TABLE risk_score SCHEMAFULL;
DEFINE FIELD session_id ON risk_score TYPE string;
DEFINE FIELD technical_risk ON risk_score TYPE float;
DEFINE FIELD legal_exposure ON risk_score TYPE float;
DEFINE FIELD market_conditions ON risk_score TYPE float;
DEFINE FIELD mitigation_profile ON risk_score TYPE object;    -- {legal_conformity, human_oversight, architectural, evidentiary}
DEFINE FIELD overall_risk ON risk_score TYPE float;
DEFINE FIELD premium_estimate ON risk_score TYPE option<string>;
DEFINE FIELD confidence ON risk_score TYPE float;
DEFINE FIELD reasoning ON risk_score TYPE string;
DEFINE FIELD top_exposures ON risk_score TYPE array<object>;
DEFINE FIELD recommendations ON risk_score TYPE array<object>;
DEFINE FIELD created_at ON risk_score TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_risk_session ON risk_score FIELDS session_id;

-- Scenario simulations
DEFINE TABLE risk_scenario SCHEMAFULL;
DEFINE FIELD session_id ON risk_scenario TYPE string;
DEFINE FIELD scenario_type ON risk_scenario TYPE string;      -- "hallucination", "contract_formation", "data_breach", "scope_creep", "adversarial"
DEFINE FIELD description ON risk_scenario TYPE string;
DEFINE FIELD probability ON risk_scenario TYPE float;
DEFINE FIELD severity ON risk_scenario TYPE float;
DEFINE FIELD expected_loss ON risk_scenario TYPE string;
DEFINE FIELD applicable_doctrines ON risk_scenario TYPE array<string>;
DEFINE FIELD mitigation_options ON risk_scenario TYPE array<string>;
DEFINE FIELD created_at ON risk_scenario TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_scenario_session ON risk_scenario FIELDS session_id;

-- ==========
-- OPERATIONAL: Same infra tables as before
-- ==========

DEFINE TABLE audit_log SCHEMAFULL;
DEFINE FIELD session_id ON audit_log TYPE string;
DEFINE FIELD agent ON audit_log TYPE string;
DEFINE FIELD action ON audit_log TYPE string;
DEFINE FIELD input_data ON audit_log TYPE option<object>;
DEFINE FIELD output_data ON audit_log TYPE option<object>;
DEFINE FIELD token_usage ON audit_log TYPE option<object>;
DEFINE FIELD cost_usd ON audit_log TYPE option<float>;
DEFINE FIELD latency_ms ON audit_log TYPE option<int>;
DEFINE FIELD timestamp ON audit_log TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_audit_session ON audit_log FIELDS session_id;

DEFINE TABLE rate_limit SCHEMAFULL;
DEFINE FIELD user_id ON rate_limit TYPE string;
DEFINE FIELD window_start ON rate_limit TYPE datetime;
DEFINE FIELD request_count ON rate_limit TYPE int DEFAULT 0;
DEFINE FIELD token_budget_used ON rate_limit TYPE int DEFAULT 0;
DEFINE FIELD token_budget_max ON rate_limit TYPE int DEFAULT 100000;
DEFINE INDEX idx_rate_user ON rate_limit FIELDS user_id;

DEFINE TABLE cost_summary SCHEMAFULL;
DEFINE FIELD user_id ON cost_summary TYPE string;
DEFINE FIELD period ON cost_summary TYPE string;
DEFINE FIELD total_tokens ON cost_summary TYPE int DEFAULT 0;
DEFINE FIELD total_cost_usd ON cost_summary TYPE float DEFAULT 0.0;
DEFINE FIELD invocation_count ON cost_summary TYPE int DEFAULT 0;
DEFINE INDEX idx_cost_user_period ON cost_summary FIELDS user_id, period UNIQUE;

DEFINE TABLE evaluation SCHEMAFULL;
DEFINE FIELD session_id ON evaluation TYPE string;
DEFINE FIELD score ON evaluation TYPE float;
DEFINE FIELD feedback_type ON evaluation TYPE string;
DEFINE FIELD feedback_detail ON evaluation TYPE option<string>;
DEFINE FIELD evaluator ON evaluation TYPE string;
DEFINE FIELD timestamp ON evaluation TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_eval_session ON evaluation FIELDS session_id;

DEFINE TABLE prompt_version SCHEMAFULL;
DEFINE FIELD agent ON prompt_version TYPE string;
DEFINE FIELD version ON prompt_version TYPE int;
DEFINE FIELD template ON prompt_version TYPE string;
DEFINE FIELD active ON prompt_version TYPE bool DEFAULT false;
DEFINE FIELD performance_score ON prompt_version TYPE option<float>;
DEFINE FIELD created_at ON prompt_version TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_prompt_agent_version ON prompt_version FIELDS agent, version UNIQUE;

DEFINE TABLE api_key SCHEMAFULL;
DEFINE FIELD user_id ON api_key TYPE string;
DEFINE FIELD key_hash ON api_key TYPE string;
DEFINE FIELD scopes ON api_key TYPE array<string>;
DEFINE FIELD active ON api_key TYPE bool DEFAULT true;
DEFINE FIELD created_at ON api_key TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_api_key_hash ON api_key FIELDS key_hash UNIQUE;
