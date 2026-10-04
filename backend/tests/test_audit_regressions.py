"""Local API boundary regressions; no database or provider calls."""
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
import schemas
from routers import mvp


class ErrorBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.app = main.PublicAPI(exception_handlers={Exception: main.internal_error})

        @self.app.get('/controlled-error')
        def fail():
            raise RuntimeError('SENTINEL_PRIVATE_PASSWORD_AND_PROVIDER_BODY')

        @self.app.get('/denied')
        def denied():
            raise HTTPException(status_code=401, detail='Not authenticated')

        self.client = TestClient(self.app, raise_server_exceptions=False)
        self.origin = main.cors_origins[0]

    def test_unhandled_error_is_sanitized_and_has_allowed_cors(self):
        response = self.client.get('/controlled-error', headers={'Origin': self.origin})
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers['access-control-allow-origin'], self.origin)
        self.assertNotIn('SENTINEL', response.text)
        self.assertEqual(response.json(), {'detail': 'An internal error occurred. Please try again.'})

    def test_disallowed_origin_does_not_gain_access_on_error(self):
        response = self.client.get('/controlled-error', headers={'Origin': 'https://evil.invalid'})
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('access-control-allow-origin', response.headers)

    def test_authorization_errors_and_preflight_keep_cors(self):
        response = self.client.get('/denied', headers={'Origin': self.origin})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers['access-control-allow-origin'], self.origin)
        response = self.client.options('/denied', headers={
            'Origin': self.origin, 'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'authorization',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['access-control-allow-origin'], self.origin)


class AnalyticsReadinessTests(unittest.TestCase):
    def test_feedback_accepts_learning_space_category_and_legacy_category(self):
        for category in ['I need access to a learning space', 'I am not a CU student']:
            request = schemas.PublicFeedbackRequest(category=category, message='I need help with access.', page_path='/feedback')
            self.assertEqual(request.category, category)

    def analytics(self, payload):
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
        db.query.return_value.filter.return_value.all.return_value = []
        with patch.object(mvp, 'readiness_payload', return_value=payload):
            return mvp.student_analytics(1, db=db, current_user=MagicMock(id=1))

    def test_four_answers_one_attempt_does_not_publish_overall_percentage(self):
        result = self.analytics({'available': False, 'score': None,
            'topics': [{'topic': 'Qualification', 'score': 100}],
            'evidence_used': {'answered_questions': 4, 'attempts': 1}})
        self.assertIsNone(result['overall_readiness']['score'])
        self.assertFalse(result['overall_readiness']['available'])
        self.assertEqual(result['readiness'][0]['score'], 100)

    def test_canonical_weighted_percentage_not_average_of_topics(self):
        result = self.analytics({'available': True, 'score': 70,
            'topics': [{'topic': 'A', 'score': 100}, {'topic': 'B', 'score': 60}]})
        self.assertEqual(result['overall_readiness']['score'], 70)

    def test_legacy_scores_are_not_promoted_to_quiz_readiness(self):
        result = self.analytics({'available': False, 'score': None, 'topics': []})
        self.assertEqual(result['readiness'], [])
        self.assertIsNone(result['overall_readiness']['score'])

    def test_cross_user_analytics_remain_denied(self):
        with self.assertRaises(HTTPException) as error:
            mvp.student_analytics(2, db=MagicMock(), current_user=MagicMock(id=1))
        self.assertEqual(error.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
