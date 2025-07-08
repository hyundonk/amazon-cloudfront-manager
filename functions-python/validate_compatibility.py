#!/usr/bin/env python3
"""
CloudFront Manager Feature Compatibility Validation Script

This script validates that Python Lambda functions maintain feature compatibility
with their Node.js counterparts by testing API contracts, response formats,
and core functionality.
"""

import json
import requests
import time
import sys
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed

@dataclass
class TestCase:
    name: str
    endpoint: str
    method: str = 'GET'
    payload: Optional[Dict[str, Any]] = None
    expected_status: int = 200
    required_fields: List[str] = None
    nodejs_only: bool = False
    python_only: bool = False

class CompatibilityValidator:
    def __init__(self, nodejs_base_url: str, python_base_url: str):
        self.nodejs_base_url = nodejs_base_url.rstrip('/')
        self.python_base_url = python_base_url.rstrip('/')
        self.test_results = []
        
    def create_test_cases(self) -> List[TestCase]:
        """Create comprehensive test cases for all endpoints"""
        return [
            # Distributions
            TestCase(
                name="List Distributions",
                endpoint="/distributions",
                required_fields=["success", "data"]
            ),
            TestCase(
                name="Get Distribution (Non-existent)",
                endpoint="/distributions/test-404",
                expected_status=404,
                required_fields=["success", "message"]
            ),
            TestCase(
                name="Create Distribution (Invalid)",
                endpoint="/distributions",
                method="POST",
                payload={"invalid": "data"},
                expected_status=400,
                required_fields=["success", "message"]
            ),
            
            # Templates
            TestCase(
                name="List Templates",
                endpoint="/templates",
                required_fields=["success", "data"]
            ),
            TestCase(
                name="Get Template (Non-existent)",
                endpoint="/templates/test-404",
                expected_status=404,
                required_fields=["success", "error"]
            ),
            TestCase(
                name="Create Template (Invalid)",
                endpoint="/templates",
                method="POST",
                payload={"invalid": "data"},
                expected_status=400,
                required_fields=["success", "error"]
            ),
            
            # Origins
            TestCase(
                name="List Origins",
                endpoint="/origins",
                required_fields=["success", "data"]
            ),
            TestCase(
                name="Create Origin (Invalid)",
                endpoint="/origins",
                method="POST",
                payload={"invalid": "data"},
                expected_status=400,
                required_fields=["success", "message"]
            ),
            
            # Certificates
            TestCase(
                name="List Certificates",
                endpoint="/certificates",
                required_fields=["success", "data"]
            ),
            
            # CORS Preflight Tests
            TestCase(
                name="CORS Preflight - Distributions",
                endpoint="/distributions",
                method="OPTIONS",
                expected_status=200
            ),
            TestCase(
                name="CORS Preflight - Templates",
                endpoint="/templates",
                method="OPTIONS",
                expected_status=200
            ),
        ]
    
    def make_request(self, base_url: str, test_case: TestCase) -> Dict[str, Any]:
        """Make HTTP request and return structured result"""
        url = f"{base_url}{test_case.endpoint}"
        
        try:
            start_time = time.time()
            
            headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
            
            if test_case.method.upper() == 'GET':
                response = requests.get(url, headers=headers, timeout=30)
            elif test_case.method.upper() == 'POST':
                response = requests.post(url, json=test_case.payload, headers=headers, timeout=30)
            elif test_case.method.upper() == 'OPTIONS':
                response = requests.options(url, headers=headers, timeout=30)
            else:
                raise ValueError(f"Unsupported method: {test_case.method}")
            
            end_time = time.time()
            
            # Parse response
            try:
                response_data = response.json() if response.content else {}
            except json.JSONDecodeError:
                response_data = {"raw_content": response.text}
            
            return {
                'success': True,
                'status_code': response.status_code,
                'response_time': end_time - start_time,
                'data': response_data,
                'headers': dict(response.headers),
                'error': None
            }
            
        except Exception as error:
            return {
                'success': False,
                'status_code': None,
                'response_time': None,
                'data': {},
                'headers': {},
                'error': str(error)
            }
    
    def validate_response_structure(self, test_case: TestCase, response_data: Dict[str, Any]) -> List[str]:
        """Validate response structure against expected fields"""
        issues = []
        
        if not test_case.required_fields:
            return issues
        
        for field in test_case.required_fields:
            if field not in response_data:
                issues.append(f"Missing required field: {field}")
        
        return issues
    
    def validate_cors_headers(self, headers: Dict[str, str]) -> List[str]:
        """Validate CORS headers are present and correct"""
        issues = []
        required_cors_headers = [
            'Access-Control-Allow-Origin',
            'Access-Control-Allow-Methods',
            'Access-Control-Allow-Headers'
        ]
        
        for header in required_cors_headers:
            if header not in headers:
                issues.append(f"Missing CORS header: {header}")
        
        return issues
    
    def compare_responses(self, test_case: TestCase, nodejs_result: Dict[str, Any], 
                         python_result: Dict[str, Any]) -> Dict[str, Any]:
        """Compare Node.js and Python responses for compatibility"""
        comparison = {
            'test_case': test_case.name,
            'status_match': nodejs_result['status_code'] == python_result['status_code'],
            'both_successful': (
                nodejs_result['status_code'] == test_case.expected_status and
                python_result['status_code'] == test_case.expected_status
            ),
            'nodejs_faster': False,
            'python_faster': False,
            'structure_compatible': True,
            'cors_compatible': True,
            'issues': []
        }
        
        # Compare response times
        if nodejs_result['response_time'] and python_result['response_time']:
            if nodejs_result['response_time'] < python_result['response_time']:
                comparison['nodejs_faster'] = True
            else:
                comparison['python_faster'] = True
        
        # Validate response structures
        if comparison['both_successful']:
            nodejs_issues = self.validate_response_structure(test_case, nodejs_result['data'])
            python_issues = self.validate_response_structure(test_case, python_result['data'])
            
            if nodejs_issues:
                comparison['issues'].extend([f"Node.js: {issue}" for issue in nodejs_issues])
            
            if python_issues:
                comparison['issues'].extend([f"Python: {issue}" for issue in python_issues])
            
            if nodejs_issues or python_issues:
                comparison['structure_compatible'] = False
        
        # Validate CORS headers
        nodejs_cors_issues = self.validate_cors_headers(nodejs_result['headers'])
        python_cors_issues = self.validate_cors_headers(python_result['headers'])
        
        if nodejs_cors_issues or python_cors_issues:
            comparison['cors_compatible'] = False
            comparison['issues'].extend([f"Node.js CORS: {issue}" for issue in nodejs_cors_issues])
            comparison['issues'].extend([f"Python CORS: {issue}" for issue in python_cors_issues])
        
        # Check for errors
        if nodejs_result['error']:
            comparison['issues'].append(f"Node.js error: {nodejs_result['error']}")
        
        if python_result['error']:
            comparison['issues'].append(f"Python error: {python_result['error']}")
        
        return comparison
    
    def run_test_case(self, test_case: TestCase) -> Dict[str, Any]:
        """Run a single test case against both implementations"""
        print(f"Testing: {test_case.name}")
        
        # Skip implementation-specific tests
        if test_case.nodejs_only:
            nodejs_result = self.make_request(self.nodejs_base_url, test_case)
            python_result = {'success': True, 'status_code': 200, 'data': {}, 'headers': {}, 'error': None, 'response_time': 0}
        elif test_case.python_only:
            nodejs_result = {'success': True, 'status_code': 200, 'data': {}, 'headers': {}, 'error': None, 'response_time': 0}
            python_result = self.make_request(self.python_base_url, test_case)
        else:
            # Test both implementations
            with ThreadPoolExecutor(max_workers=2) as executor:
                nodejs_future = executor.submit(self.make_request, self.nodejs_base_url, test_case)
                python_future = executor.submit(self.make_request, self.python_base_url, test_case)
                
                nodejs_result = nodejs_future.result()
                python_result = python_future.result()
        
        # Compare results
        comparison = self.compare_responses(test_case, nodejs_result, python_result)
        
        # Print immediate feedback
        if comparison['both_successful'] and comparison['structure_compatible'] and comparison['cors_compatible']:
            print(f"  ✅ PASS - {test_case.name}")
        else:
            print(f"  ❌ FAIL - {test_case.name}")
            for issue in comparison['issues']:
                print(f"    ⚠️  {issue}")
        
        # Performance feedback
        if nodejs_result['response_time'] and python_result['response_time']:
            faster = "Node.js" if comparison['nodejs_faster'] else "Python"
            nodejs_time = nodejs_result['response_time']
            python_time = python_result['response_time']
            print(f"    🏃 {faster} faster ({nodejs_time:.3f}s vs {python_time:.3f}s)")
        
        return {
            'test_case': test_case,
            'nodejs_result': nodejs_result,
            'python_result': python_result,
            'comparison': comparison
        }
    
    def run_all_tests(self) -> Dict[str, Any]:
        """Run all compatibility tests"""
        print("🚀 Starting CloudFront Manager Compatibility Validation")
        print("=" * 70)
        
        test_cases = self.create_test_cases()
        results = []
        
        for test_case in test_cases:
            try:
                result = self.run_test_case(test_case)
                results.append(result)
                print()  # Add spacing between tests
            except Exception as error:
                print(f"  💥 ERROR - {test_case.name}: {error}")
                results.append({
                    'test_case': test_case,
                    'error': str(error)
                })
        
        # Generate summary
        total_tests = len(results)
        successful_tests = sum(1 for r in results 
                             if r.get('comparison', {}).get('both_successful', False) and
                                r.get('comparison', {}).get('structure_compatible', False) and
                                r.get('comparison', {}).get('cors_compatible', False))
        
        compatibility_score = (successful_tests / total_tests) * 100 if total_tests > 0 else 0
        
        print("=" * 70)
        print(f"📊 COMPATIBILITY SUMMARY")
        print(f"Total Tests: {total_tests}")
        print(f"Successful Tests: {successful_tests}")
        print(f"Compatibility Score: {compatibility_score:.1f}%")
        
        if compatibility_score >= 90:
            print("🎉 EXCELLENT - High compatibility between implementations")
        elif compatibility_score >= 75:
            print("✅ GOOD - Acceptable compatibility with minor issues")
        elif compatibility_score >= 50:
            print("⚠️  FAIR - Significant compatibility issues need attention")
        else:
            print("❌ POOR - Major compatibility problems require immediate attention")
        
        return {
            'summary': {
                'total_tests': total_tests,
                'successful_tests': successful_tests,
                'compatibility_score': compatibility_score
            },
            'results': results
        }
    
    def generate_report(self, results: Dict[str, Any], output_file: str = 'compatibility_report.json'):
        """Generate detailed compatibility report"""
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        
        print(f"📄 Detailed report saved to: {output_file}")

def main():
    """Main function to run compatibility validation"""
    # Configuration - update these URLs with your actual API endpoints
    NODEJS_API_URL = "https://your-nodejs-api-id.execute-api.region.amazonaws.com/api"
    PYTHON_API_URL = "https://your-python-api-id.execute-api.region.amazonaws.com/prod"
    
    # Check if URLs are configured
    if "your-" in NODEJS_API_URL or "your-" in PYTHON_API_URL:
        print("❌ Please update the API URLs in the script before running validation")
        print(f"Node.js API URL: {NODEJS_API_URL}")
        print(f"Python API URL: {PYTHON_API_URL}")
        sys.exit(1)
    
    # Run validation
    validator = CompatibilityValidator(NODEJS_API_URL, PYTHON_API_URL)
    results = validator.run_all_tests()
    
    # Generate report
    validator.generate_report(results)
    
    # Exit with appropriate code
    if results['summary']['compatibility_score'] >= 75:
        print("\n🎯 Validation completed successfully!")
        sys.exit(0)
    else:
        print("\n⚠️  Validation completed with issues. Check the report for details.")
        sys.exit(1)

if __name__ == "__main__":
    main()

"""
Usage:
1. Update the API URLs in the main() function
2. Install dependencies: pip install requests
3. Run the script: python validate_compatibility.py

The script will:
- Test all implemented endpoints in both Node.js and Python
- Compare response formats, status codes, and CORS headers
- Measure performance differences
- Generate a detailed compatibility report
- Provide a compatibility score and recommendations

Example output:
🚀 Starting CloudFront Manager Compatibility Validation
======================================================================
Testing: List Distributions
  ✅ PASS - List Distributions
    🏃 Python faster (0.245s vs 0.312s)

Testing: List Templates
  ✅ PASS - List Templates
    🏃 Node.js faster (0.156s vs 0.203s)

======================================================================
📊 COMPATIBILITY SUMMARY
Total Tests: 10
Successful Tests: 8
Compatibility Score: 80.0%
✅ GOOD - Acceptable compatibility with minor issues
📄 Detailed report saved to: compatibility_report.json
🎯 Validation completed successfully!
"""
